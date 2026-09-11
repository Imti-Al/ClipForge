const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

function dialog(api) {
  const slots = [], timers = new Map();
  let cursor = 0, effects = [], timerId = 0;
  const react = {
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
    window: { electronAPI: api }, console,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  const flatten = node => node == null ? [] : typeof node !== 'object' ? [node] : [node, ...node.children.flat(Infinity).flatMap(flatten)];
  return {
    render() { cursor = 0; const tree = flatten(exports.ExportModal({ videoSrc: 'safe-file:C:/source.mp4', inTime: 4, outTime: 10, onClose() {} }));
      const pending = effects; effects = []; pending.forEach(fn => fn()); return tree; },
    update(changes) { slots[0] = { ...slots[0], ...changes }; this.render(); },
    text() { return this.render().filter(value => typeof value === 'string').join(' '); },
    async timers() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await tick(); },
  };
}

test('dialog shows variable CRF/CQ, gates NVENC and ignores obsolete target estimates', async () => {
  const requests = [], replies = [];
  const view = dialog({
    getEncoderCapabilities: async () => ({ success: true, data: { nvenc: false, reason: 'No compatible GPU' } }),
    getExportEstimate: options => { requests.push(options); return new Promise(resolve => replies.push(resolve)); },
  });
  view.render(); await tick();
  assert.match(view.text(), /Variable/); assert.match(view.text(), /cannot be accurately predicted/);
  assert.match(view.text(), /No compatible GPU/);
  const gpuButton = view.render().find(node => node.type === 'button' && String(node.props.onClick).includes('useGpu'));
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
  let callback, finish;
  const view = dialog({ getEncoderCapabilities: async () => ({ success: true, data: { nvenc: true, reason: '' } }),
    onExportProgress: fn => { callback = fn; return () => {}; },
    exportVideo: () => new Promise(resolve => { finish = resolve; }),
  });
  view.render(); await tick(); view.update({ outputPath: 'C:/out.mp4' });
  const button = view.render().find(node => node.type === 'button' && node.children.includes('Start Export'));
  const operation = button.props.onClick();
  callback({ progress: 50, currentTime: 6, speed: 100, etaSeconds: 65 });
  assert.match(view.text(), /1:05/); assert.ok(!view.text().includes('100'));
  finish({ success: true, data: { outputPath: 'C:/out.mp4' } }); await operation;
  assert.ok(view.render().includes(100));
});

test('web preview without preload remains usable with explicitly unavailable estimates', () => {
  const view = dialog(undefined); view.render(); assert.match(view.text(), /Variable/);
  view.update({ mode: 'target' }); assert.match(view.text(), /Unavailable outside/);
});
