const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function editor(api) {
  // Adapt the existing scenario fixtures to the standardized transport envelope.
  const transportedApi = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, name === 'getPathForFile' ? fn : async (...args) => {
    const result = await fn(...args);
    if (result?.success === false) return { ...result, code: 'REQUEST_FAILED' };
    if (name === 'projectOpenSidecar') return result;
    if (result?.success === true) { const { success, ...data } = result; void success; return { success: true, data }; }
    return { success: true, data: result };
  }]));
  let slots = [], cursor = 0;
  let isModalOpen = false;
  let effects = [], clock = 0, nextTimer = 0, closed = false;
  transportedApi.closeWindow = async approved => { closed = approved; return { success: true }; };
  const timers = new Map(), listeners = new Map();
  transportedApi.onCloseRequested = callback => { listeners.set('closeRequested', callback); return () => listeners.delete('closeRequested'); };
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(init) { const i = cursor++; return slots[i] ?? (slots[i] = { current: init }); },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !equalDeps(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !equalDeps(slots[i].deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  };
  react.default = react;
  const exports = {};
  const ipcExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/ipc.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText, { exports: ipcExports });
  const importExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/importBlob.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText, { exports: importExports, require: () => ipcExports, crypto: require('node:crypto').webcrypto });
  const code = ts.transpileModule(fs.readFileSync('src/components/MainEditor.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
  }).outputText;
  vm.runInNewContext(code, {
    HTMLElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    exports, require: name => name === 'react' ? react : name === '../utils/ipc' ? ipcExports : name === '../utils/importBlob' ? importExports : { default: name, X: 'X' },
    window: { electronAPI: transportedApi, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), close: () => { closed = true; } }, console,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, due: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const all = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flat(Infinity).flatMap(all)];
  return {
    render() { cursor = 0; const tree = all(exports.default({ isModalOpen, onOpenExport() {}, onOpenRemux() {}, onVideoStateChange() {} })); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; },
    setModalOpen(value) { isModalOpen = value; this.render(); },
    key(code) { this.render(); listeners.get('keydown')({ code, key: '', target: {}, preventDefault() {} }); },
    props(type) { return this.render().find(node => node.type === './' + type).props; },
    async advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.fn(); } await new Promise(resolve => setImmediate(resolve)); },
    close() { listeners.get('beforeunload')({ preventDefault() {}, returnValue: '' }); },
    nativeClose() { listeners.get('closeRequested')(); },
    get closed() { return closed; },
    drop(file) { return this.render()[0].props.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: { files: [file], items: [], getData: () => '' } }); },
    changePreferences(update) { const i = slots.findIndex(value => value && value.copyAudio !== undefined && value.preset); slots[i] = { ...slots[i], ...update }; },
  };
}

test('rapid A to B opens suppress stale metadata, errors, and old preview callbacks', async () => {
  for (const fails of [false, true]) {
    let resolveA, rejectA, count = 0;
    const app = editor(tempApi({ openVideoDialog: async () => ++count === 1 ? 'A.mp4' : 'B.mp4',
      getVideoInfo: source => source === 'A.mp4' ? new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }) : Promise.resolve({ duration: 25 }),
    }));
    const a = app.props('MenuBar').onLoadVideo(); await app.advance(0);
    await app.props('MenuBar').onLoadVideo();
    if (fails) rejectA(new Error('obsolete failure')); else resolveA({ duration: 600 });
    await a;
    assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:B.mp4');
    assert.equal(app.props('Timeline').duration, 25);
    assert.equal(app.render().some(node => node.props.role === 'alert'), false);
    const oldPreview = app.props('VideoPreview');
    await app.props('MenuBar').onLoadVideo(); oldPreview.onTimeUpdate(999);
    assert.equal(app.props('Timeline').currentTime, 0);
  }
});

test('stale sidecar and open-project dialog completions cannot replace a newer source', async () => {
  let readA, picker, path = 'A.mp4';
  const app = editor(tempApi({ openVideoDialog: async () => path, isTempImport: async () => false,
    projectDefaultPath: async source => source + '.clipforge', projectExists: async source => source.startsWith('A'),
    projectOpenSidecar: () => new Promise(resolve => { readA = resolve; }),
    showOpenProjectDialog: () => new Promise(resolve => { picker = resolve; }),
    projectSaveFile: async () => ({ success: true }),
  }));
  const a = app.props('MenuBar').onLoadVideo(); await app.advance(0);
  path = 'B.mp4'; await app.props('MenuBar').onLoadVideo();
  readA({ success: true, data: { segments: [{ id: 'old', start: 8, end: 11 }] } }); await a;
  assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:B.mp4');
  assert.equal(app.props('Timeline').inTime, 0);
  const project = app.props('MenuBar').onOpenProject();
  path = 'C.mp4'; await app.props('MenuBar').onLoadVideo();
  picker('obsolete.clipforge'); await project;
  assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:C.mp4');
});

test('current load errors remain visible and normal path-backed drops never copy media', async () => {
  let probes = 0;
  const app = editor(tempApi({ getPathForFile: () => 'C:/original.mp4', getVideoInfo: async () => {
    if (++probes > 1) throw new Error('Current probe failed'); return { duration: 7 };
  }, beginImport: () => { throw new Error('Path backed video must not be copied'); } }));
  await app.drop({ name: 'original.mp4', arrayBuffer() { throw new Error('Must not buffer'); } });
  assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:C:/original.mp4');
  await app.props('MenuBar').onLoadVideo();
  assert.ok(app.render().some(node => node.props.role === 'alert' && node.children.some(text => /Current probe failed/.test(text))));
  assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:C:/original.mp4');
});

test('a stalled close flush leaves the editor open with a recoverable error instead of hanging silently', async () => {
  const app = editor(tempApi({ isTempImport: async () => false, projectExists: async () => false,
    projectSaveFile: async () => new Promise(() => {}),
  }));
  await app.props('MenuBar').onLoadVideo(); app.render();
  app.nativeClose(); await app.advance(5001);
  assert.equal(app.closed, false);
  assert.ok(app.render().some(node => node.props.role === 'alert' && node.children.some(text => /taking too long/.test(text))));
});

function tempApi(overrides = {}) {
  return {
    openVideoDialog: async () => 'C:/temp/video.mp4', isTempImport: async () => true,
    getVideoInfo: async () => ({ duration: 12 }),
    showSaveVideoDialogForSource: async () => 'C:/saved/video.mp4',
    projectDefaultPath: async () => 'C:/saved/custom.clipforge',
    projectSetDeleteOnExit: async () => true,
    moveFile: async () => ({ success: true, dst: 'C:/saved/video.mp4' }),
    projectSaveSidecar: async () => ({ success: true, path: 'C:/saved/custom.clipforge' }),
    ...overrides,
  };
}

test('editor shortcuts cannot trim or play behind a dialog; frame stepping pauses playback', async () => {
  const app = editor(tempApi());
  await app.props('MenuBar').onLoadVideo();
  app.props('VideoPreview').onTimeUpdate(6);
  app.setModalOpen(true);
  app.key('KeyI'); app.key('Space');
  assert.equal(app.props('Timeline').inTime, 0);
  assert.equal(app.props('VideoPreview').isPlaying, false);
  app.setModalOpen(false);
  app.key('KeyI'); app.key('Space');
  assert.equal(app.props('Timeline').inTime, 6);
  assert.equal(app.props('VideoPreview').isPlaying, true);
  app.key('Period');
  assert.equal(app.props('VideoPreview').isPlaying, false);
  assert.ok(app.props('VideoPreview').currentTime > 6);
});

test('new media and segment edits stay inside actual duration', async () => {
  const app = editor(tempApi());
  await app.props('MenuBar').onLoadVideo();
  assert.equal(app.props('Sidebar').segments[0].end, 12);
  app.props('Timeline').onInTimeChange(99);
  app.props('Timeline').onOutTimeChange(-5);
  const timeline = app.props('Timeline');
  assert.ok(timeline.inTime <= timeline.outTime);
  assert.ok(timeline.outTime <= 12);
  app.props('VideoPreview').onLoadedMetadata(600);
  assert.equal(app.props('Timeline').duration, 12);
});

test('restoration reconciles invalid active id, duplicate ids and invalid bounds', async () => {
  const app = editor(tempApi({
    isTempImport: async () => false, projectExists: async () => true,
    projectOpenSidecar: async () => ({ success: true, data: {
      segments: [{ id: 'x', start: -10, end: 100 }, { id: 'x', start: 9, end: 2 }],
      activeSegmentId: 'missing', selection: { inTime: 30, outTime: -2 }, playhead: 900,
    } }),
  }));
  await app.props('MenuBar').onLoadVideo();
  const side = app.props('Sidebar');
  assert.ok(side.segments.some(s => s.id === side.activeSegmentId));
  assert.equal(new Set(side.segments.map(s => s.id)).size, side.segments.length);
  for (const segment of side.segments) assert.ok(segment.start >= 0 && segment.start <= segment.end && segment.end <= 12);
  assert.equal(app.props('Timeline').currentTime, 12);
});

test('failed temp move never writes a project', async () => {
  let saves = 0;
  const app = editor(tempApi({ moveFile: async () => ({ success: false, error: 'Disk full' }), projectSaveSidecar: async () => { saves++; } }));
  await app.props('MenuBar').onLoadVideo();
  await app.props('MenuBar').onSaveProjectAs();
  assert.equal(saves, 0);
  assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:C:/temp/video.mp4');
  assert.ok(app.render().some(node => node.props.role === 'alert'));
});

test('temp save writes permanent source reference; failed project write remains recoverable', async () => {
  let saved;
  const app = editor(tempApi({ projectSaveSidecar: async (source, data) => { saved = data; return { success: false, error: 'Read only' }; } }));
  await app.props('MenuBar').onLoadVideo();
  await app.props('MenuBar').onSaveProjectAs();
  assert.equal(saved.sourceVideo.path, 'C:/saved/video.mp4');
  assert.equal(app.props('VideoPreview').videoSrc, 'safe-file:C:/saved/video.mp4');
  assert.ok(app.render().some(node => node.props.role === 'alert'));
});

function permanentApi(overrides = {}) {
  return tempApi({ isTempImport: async () => false, projectExists: async () => false,
    projectSaveFile: async () => ({ success: true }), ...overrides });
}

test('full-range and segment-only changes autosave; playback does not postpone the timer', async () => {
  const writes = [];
  const app = editor(permanentApi({ projectSaveFile: async (path, data) => { writes.push(data); return { success: true }; } }));
  await app.props('MenuBar').onLoadVideo();
  app.render();
  await app.advance(300);
  app.props('Timeline').onInTimeChange(3);
  app.render(); await app.advance(300);
  app.props('Timeline').onInTimeChange(0);
  app.render(); await app.advance(300);
  assert.equal(writes.at(-1).selection.inTime, 0);
  app.props('Sidebar').onAddSegment(); app.render();
  for (let i = 0; i < 4; i++) { app.props('VideoPreview').onTimeUpdate(i); app.render(); await app.advance(100); }
  assert.equal(writes.at(-1).segments.length, 2);
  app.changePreferences({ crfValue: 19 }); app.render(); await app.advance(300);
  assert.equal(writes.at(-1).encoderPrefs.crfValue, 19);
});

test('an older save cannot clear a newer edit; close flushes the newest snapshot', async () => {
  let complete;
  const writes = [];
  const app = editor(permanentApi({ projectSaveFile: (path, data) => {
    writes.push(data);
    return writes.length === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ success: true });
  } }));
  await app.props('MenuBar').onLoadVideo(); app.render(); await app.advance(300);
  app.props('Timeline').onInTimeChange(4); app.render();
  complete({ success: true }); await app.advance(0);
  assert.ok(app.render().some(node => node.children.includes('Unsaved changes')));
  app.close(); await app.advance(0);
  assert.equal(writes.at(-1).selection.inTime, 4);
  assert.equal(app.closed, true);
});

test('switch flushes edits and failed writes prevent closing', async () => {
  let fail = false;
  const writes = [];
  const app = editor(permanentApi({ projectSaveFile: async (path, data) => {
    writes.push(data); return fail ? { success: false, error: 'Disk full' } : { success: true };
  } }));
  await app.props('MenuBar').onLoadVideo(); app.render();
  app.props('Timeline').onInTimeChange(2); app.render();
  await app.props('MenuBar').onLoadVideo();
  assert.equal(writes.at(-1).selection.inTime, 2);
  app.render(); fail = true; app.close(); await app.advance(0);
  assert.equal(app.closed, false);
  assert.ok(app.render().some(node => node.props.role === 'alert'));
});

test('Save As and subsequent manual saves keep the exact destination and original source', async () => {
  const writes = [];
  const app = editor(permanentApi({ showSaveProjectDialog: async () => 'C:/other/chosen.llc',
    projectSaveFile: async (path, data) => { writes.push({ path, data }); return { success: true, path }; }
  }));
  await app.props('MenuBar').onLoadVideo(); app.render();
  await app.props('MenuBar').onSaveProjectAs(); app.render();
  app.props('Timeline').onInTimeChange(1); app.render(); await app.advance(300);
  assert.equal(writes.at(-1).path, 'C:/other/chosen.llc');
  assert.equal(writes.at(-1).data.sourceVideo.path, 'C:/temp/video.mp4');
});

test('reverting to the previously saved state during a write still persists the revert', async () => {
  let complete;
  const writes = [];
  const app = editor(permanentApi({ projectSaveFile: (path, data) => {
    writes.push(data);
    return writes.length === 2 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ success: true });
  } }));
  await app.props('MenuBar').onLoadVideo(); app.render(); await app.advance(300);
  app.props('Timeline').onInTimeChange(3); app.render(); await app.advance(300);
  app.props('Timeline').onInTimeChange(0); app.render();
  complete({ success: true }); await app.advance(0); app.render(); await app.advance(300);
  assert.equal(writes.length, 3);
  assert.equal(writes.at(-1).selection.inTime, 0);
});

test('edits during a temporary media move remain dirty and save to the permanent source', async () => {
  let complete;
  const writes = [];
  const app = editor(tempApi({
    moveFile: () => new Promise(resolve => { complete = resolve; }),
    projectSaveFile: async (path, data) => { writes.push(data); return { success: true }; },
  }));
  await app.props('MenuBar').onLoadVideo(); app.render();
  const saving = app.props('MenuBar').onSaveProjectAs(); await app.advance(0);
  app.props('Timeline').onInTimeChange(5); app.render();
  complete({ success: true, dst: 'C:/saved/video.mp4' }); await saving;
  assert.ok(app.render().some(node => node.children.includes('Unsaved changes')));
  await app.advance(300);
  assert.equal(writes.at(-1).selection.inTime, 5);
  assert.equal(writes.at(-1).sourceVideo.path, 'C:/saved/video.mp4');
});
