const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));

function dialog(api) {
  const slots = []; let cursor = 0;
  const react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  };
  react.default = react;
  const exports = {}, ipc = {};
  const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(compile('src/utils/ipc.ts'), { exports: ipc });
  vm.runInNewContext(compile('src/components/RemuxModal.tsx'), {
    exports, require: name => name === 'react' ? react : name === '../utils/ipc' ? ipc : {},
    window: { electronAPI: api }, crypto: require('node:crypto').webcrypto,
  });
  const flatten = node => node == null ? [] : typeof node !== 'object' ? [node] : [node, ...node.children.flat(Infinity).flatMap(flatten), ...flatten(node.props.footer)];
  return {
    render() { cursor = 0; return flatten(exports.default({ onClose() {} })); },
    click(text) { return this.render().find(node => node.type === 'button' && node.children.includes(text)).props.onClick(); },
    text() { return this.render().filter(value => typeof value === 'string').join(' '); },
  };
}

test('remux batch cancellation keeps completed files, stops the correct job and leaves remaining files retryable', async () => {
  const requests = [], replies = []; let progress, cancelled;
  const view = dialog({ platform: 'win32', selectMkvFiles: async () => ({ success: true, data: ['a.mkv', 'b.mkv', 'c.mkv'] }),
    getVideoInfo: async () => ({ success: true, data: { duration: 10 } }),
    onRemuxProgress: fn => { progress = fn; return () => {}; },
    remuxVideo: options => { requests.push(options); return new Promise(resolve => replies.push(resolve)); },
    cancelMediaJob: async id => { cancelled = id; return { success: true, data: true }; },
  });
  await view.click('Add files'); const operation = view.click('Remux');
  replies[0]({ success: true, data: {} }); await tick();
  assert.equal(requests.length, 2);
  progress({ jobId: requests[0].jobId, inputPath: 'b.mkv', progress: 90 });
  assert.ok(!view.text().includes('90%'));
  await view.click('Cancel batch'); assert.equal(cancelled, requests[1].jobId);
  replies[1]({ success: false, code: 'CANCELLED', error: 'Operation cancelled.' }); await operation;
  assert.equal(requests.length, 2); assert.match(view.text(), /Completed/); assert.match(view.text(), /Cancelled/); assert.match(view.text(), /Waiting/);
  assert.equal(view.render().some(node => node.props?.role === 'alert'), false);
  const retry = view.click('Remux'); assert.equal(requests[2].inputPath, 'b.mkv'); assert.notEqual(requests[2].jobId, requests[1].jobId);
  replies[2]({ success: true, data: {} }); await tick();
  assert.equal(requests[3].inputPath, 'c.mkv'); replies[3]({ success: true, data: {} }); await retry;
  assert.equal(view.render().filter(node => node === 'Completed').length, 3);
});
