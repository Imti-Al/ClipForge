const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

const capability = (id = 'libx264', available = true) => ({ id, codec: 'h264', label: id, hardware: id !== 'libx264', available,
  reason: available ? '' : 'No compatible GPU', modes: { crf: available, target: available }, twoPass: id === 'libx264',
  quality: { label: 'CRF', min: 0, max: 51, default: 23 }, presets: ['medium'], defaultPreset: 'medium' });
const capabilities = async () => ({ success: true, data: { encoders: [capability(), capability('h264_nvenc', false)] } });

function dialog(api, props = {}) {
  if (api) api = { getEncoderCapabilities: capabilities, getExportPlan: async options => ({ success: true, data: options.clips.map((clip, index) => ({
    name: clip.name, outputPath: options.clips.length === 1 ? options.outputPath : `C:/out-${index}.mp4`,
    startTime: clip.start, duration: clip.end - clip.start, actualStart: clip.start, actualEnd: clip.end, omitted: [],
  })) }), ...api };
  const slots = [], timers = new Map();
  let cursor = 0, effects = [], timerId = 0, closed = false;
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(fn, deps) { const i = cursor++, prior = slots[i];
      if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) {
        slots[i] = { deps }; effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  };
  react.default = react;
  const exports = {}, ipcExports = {};
  const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(compile('src/utils/ipc.ts'), { exports: ipcExports });
  vm.runInNewContext(compile('src/components/ExportModal.tsx'), {
    exports, require: name => name === 'react' ? react : name === '../utils/ipc' ? ipcExports : {},
    window: { electronAPI: api }, console, crypto: require('node:crypto').webcrypto,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  const flatten = node => node == null ? [] : typeof node !== 'object' ? [node] : [node, ...node.children.flat(Infinity).flatMap(flatten), ...flatten(node.props.footer)];
  return {
    get closed() { return closed; },
    render() { cursor = 0; const tree = flatten(exports.ExportModal({ videoSrc: 'safe-file:C:/source.mp4', inTime: 4, outTime: 10, ...props, onClose() { closed = true; } }));
      const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; },
    update(changes) { slots[0] = { ...slots[0], ...changes }; this.render(); },
    text() { return this.render().filter(value => typeof value === 'string').join(' '); },
    async timers() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await tick(); },
  };
}

test('dialog shows variable CRF/CQ, gates NVENC and ignores obsolete target estimates', async () => {
  const requests = [], replies = [];
  const view = dialog({
    getExportEstimate: options => { requests.push(options); return new Promise(resolve => replies.push(resolve)); },
  });
  view.render(); await tick();
  assert.match(view.text(), /Variable/); assert.match(view.text(), /cannot be accurately predicted/);
  assert.match(view.text(), /No compatible GPU/);
  const gpuButton = view.render().find(node => node.type === 'option' && node.props.value === 'h264_nvenc');
  assert.equal(gpuButton.props.disabled, true);
  view.update({ mode: 'target', targetSize: 2 }); await view.timers();
  assert.equal(requests[0].duration, 6); assert.equal(requests[0].copyAudio, true);
  view.update({ targetSize: 3 }); await view.timers();
  const result = expectedBytes => ({ success: true, data: { expectedBytes, videoBitrate: 1000000, audioBitrate: 128000 } });
  replies[1](result(2900000)); await tick(); assert.match(view.text(), /~2.90 MB/);
  replies[0](result(1900000)); await tick(); assert.match(view.text(), /~2.90 MB/);
  view.update({ mode: 'crf' }); assert.match(view.text(), /Variable/);
});

test('dialog uses job-level ETA and reaches 100 only when the complete export resolves', async () => {
  let callback, finish, jobId;
  const view = dialog({
    onExportProgress: fn => { callback = fn; return () => {}; },
    exportVideo: options => new Promise(resolve => { jobId = options.jobId; finish = resolve; }),
  });
  view.render(); await tick(); view.update({ outputPath: 'C:/out.mp4' });
  const button = view.render().find(node => node.type === 'button' && node.children.includes('Start Export'));
  const operation = button.props.onClick();
  await tick();
  callback({ jobId, progress: 50, currentTime: 6, speed: 100, etaSeconds: 65 });
  assert.match(view.text(), /65s remaining/); assert.ok(!view.text().includes('100'));
  finish({ success: true, data: { outputPath: 'C:/out.mp4' } }); await operation;
  assert.equal(view.closed, true);
});

test('web preview without preload remains usable with explicitly unavailable estimates', () => {
  const view = dialog(undefined); view.render(); assert.match(view.text(), /Variable/);
  view.update({ mode: 'target' }); assert.match(view.text(), /Unavailable outside/);
});

test('export cancellation addresses its job and ignores obsolete progress without a failure alert', async () => {
  let callback, finish, id, cancelledId;
  const view = dialog({
    onExportProgress: fn => { callback = fn; return () => {}; },
    exportVideo: options => new Promise(resolve => { id = options.jobId; finish = resolve; }),
    cancelMediaJob: async jobId => { cancelledId = jobId; return { success: true, data: true }; },
  });
  view.render(); await tick(); view.update({ outputPath: 'C:/out.mp4' });
  const operation = view.render().find(node => node.type === 'button' && node.children.includes('Start Export')).props.onClick();
  await tick();
  callback({ jobId: 'obsolete', progress: 98, etaSeconds: 999 }); assert.ok(!view.text().includes('16:39'));
  await view.render().find(node => node.type === 'button' && node.children.includes('Cancel')).props.onClick();
  assert.equal(cancelledId, id); assert.equal(view.closed, false);
  finish({ success: false, code: 'CANCELLED', error: 'Operation cancelled.' }); await operation;
  assert.match(view.text(), /Export stopped/); assert.equal(view.closed, false);
  assert.equal(view.render().some(node => node.props?.role === 'alert'), false);
});

test('batch cancellation preserves completed files and resumes only remaining clips', async () => {
  const calls = [];
  let finish;
  const view = dialog({
    onExportProgress: () => () => {},
    exportVideo: options => { calls.push(options); return new Promise(resolve => { finish = resolve; }); },
    cancelMediaJob: async () => ({ success: true, data: true }),
  }, { segments: [{ id: 'a', name: 'A', start: 0, end: 2 }, { id: 'b', name: 'B', start: 4, end: 7 }] });
  view.render(); await tick(); view.update({ outputPath: 'C:/out.mp4', scope: 'all' });
  const operation = view.render().find(node => node.type === 'button' && node.children.includes('Start Export')).props.onClick();
  await tick();
  finish({ success: true, data: { outputPath: calls[0].outputPath } }); await tick();
  assert.equal(calls[1].startTime, 4); assert.equal(calls[1].duration, 3);
  await view.render().find(node => node.type === 'button' && node.children.includes('Cancel')).props.onClick();
  finish({ success: false, code: 'CANCELLED', error: 'Cancelled' }); await operation;
  const resume = view.render().find(node => node.type === 'button' && node.children.includes('Resume remaining')).props.onClick();
  await tick(); assert.equal(calls.length, 3);
  assert.equal(calls[2].outputPath, calls[1].outputPath); assert.notEqual(calls[2].jobId, calls[1].jobId);
  finish({ success: true, data: { outputPath: calls[2].outputPath } }); await resume;
  assert.match(view.text(), /Export complete/); assert.equal(view.closed, false);
});

test('fast copy hides irrelevant compression controls', async () => {
  const view = dialog({}); view.render(); await tick(); view.update({ method: 'copy' });
  assert.equal(view.render().some(node => ['quality', 'preset', 'export-encoder'].includes(node.props?.id)), false);
  assert.match(view.text(), /not frame-exact/);
});

test('late capability discovery cannot reset a running fast-copy batch', async () => {
  let capabilitiesReady, finish;
  const calls = [];
  const view = dialog({
    getEncoderCapabilities: () => new Promise(resolve => { capabilitiesReady = resolve; }),
    onExportProgress: () => () => {},
    exportVideo: options => { calls.push(options); return new Promise(resolve => { finish = resolve; }); },
  }, { segments: [{ id: 'a', name: 'A', start: 0, end: 2 }, { id: 'b', name: 'B', start: 4, end: 7 }] });
  view.render(); view.update({ method: 'copy', scope: 'all', outputPath: 'C:/out.mp4' });
  const operation = view.render().find(node => node.type === 'button' && node.children.includes('Start Export')).props.onClick();
  await tick(); capabilitiesReady({ success: true, data: { encoders: [capability('h264_nvenc')] } });
  await tick(); view.render();
  finish({ success: true, data: { outputPath: calls[0].outputPath } }); await tick();
  assert.equal(calls.length, 2);
  finish({ success: true, data: { outputPath: calls[1].outputPath } }); await operation;
  assert.match(view.text(), /Export complete/);
});
