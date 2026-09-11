const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const { mainContext } = require('./helpers/electron.cjs');

function bridge(overrides = {}) {
  const backend = mainContext(overrides);
  const events = new EventEmitter(), calls = [];
  let api;
  vm.runInNewContext(fs.readFileSync('electron/preload.js', 'utf8'), {
    process: { platform: 'win32' },
    require: name => {
      assert.equal(name, 'electron', 'sandboxed preload must not require local modules');
      return {
        contextBridge: { exposeInMainWorld: (name, exposed) => { assert.equal(name, 'electronAPI'); api = exposed; } },
        webUtils: { getPathForFile: file => file.diskPath },
        ipcRenderer: {
          invoke: (channel, ...args) => { calls.push(channel); return backend.handlers.get(channel)({ sender: { send: (name, value) => events.emit(name, {}, value) } }, ...args); },
          on: events.on.bind(events), removeListener: events.removeListener.bind(events),
        },
      };
    },
  });
  return { api, backend, events, calls };
}

test('preload, canonical handlers and TypeScript API expose the same contract', async () => {
  const { api, backend, calls } = bridge({ dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  } });
  const ast = ts.createSourceFile('electron.d.ts', fs.readFileSync('src/types/electron.d.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'ElectronAPI');
  assert.deepEqual(Object.keys(api).sort(), declaration.members.map(member => member.name.text).sort());
  const local = ['platform', 'getPathForFile', 'onExportProgress', 'onRemuxProgress'];
  assert.deepEqual(Object.keys(api).filter(name => !local.includes(name)).sort(), [...backend.handlers.keys()].sort());
  assert.ok([...backend.handlers.keys()].every(name => /^[a-z][A-Za-z]+$/.test(name)));
  for (const name of ['openVideoDialog', 'showOpenProjectDialog', 'showSaveProjectDialog', 'showSaveVideoDialogForSource', 'showSaveVideoDialog']) {
    const result = await api[name]();
    assert.equal(result.success, true); assert.equal(result.data, null);
  }
  const selected = await api.selectMkvFiles();
  assert.equal(selected.success, true); assert.equal(selected.data.length, 0);
  assert.equal((await api.isTempImport('C:/temp/ClipForgeImports/source.mp4')).data, true);
  assert.match((await api.projectDefaultPath('C:/v.mp4')).data, /v-proj\.clipforge$/);
  assert.equal(calls.at(-1), 'projectDefaultPath');
  assert.equal(api.getPathForFile({ diskPath: 'C:/v.mp4' }), 'C:/v.mp4');
});

test('preload propagates probe, file, schema and collision failures consistently', async () => {
  const { api } = bridge({
    fs: { lstat: async () => ({}), readFile: async () => '{', rename: async () => { throw new Error('Disk full'); } },
    execFile: (_exe, _args, _options, done) => done(new Error('Probe failed')),
  });
  for (const result of await Promise.all([
    api.getVideoInfo('C:/v.mp4'), api.moveFile('a', 'b'), api.projectOpenSidecar('C:/v.llc'),
    api.exportVideo({ inputPath: 'C:/v.mp4', outputPath: 'C:/out.mp4', containerFormat: 'mp4' }),
  ])) {
    assert.equal(result.success, false); assert.equal(typeof result.error, 'string');
    assert.equal(typeof result.code, 'string'); assert.equal('data' in result, false);
  }
});

test('progress payloads pass through preload and each subscription cleans up independently', () => {
  const { api, events } = bridge();
  const first = [], second = [];
  const offFirst = api.onExportProgress(data => first.push(data));
  const offSecond = api.onExportProgress(data => second.push(data));
  const payload = { progress: 50, currentTime: 1, speed: 2 };
  events.emit('exportProgress', {}, payload); offFirst();
  events.emit('exportProgress', {}, payload); offSecond();
  assert.equal(first.length, 1); assert.equal(second.length, 2);
  assert.equal(first[0], payload); assert.equal(events.listenerCount('exportProgress'), 0);
  const offRemux = api.onRemuxProgress(data => first.push(data));
  events.emit('remuxProgress', {}, { ...payload, inputPath: 'C:/source.mkv' }); offRemux();
  assert.equal(first.at(-1).inputPath, 'C:/source.mkv');
  assert.equal(events.listenerCount('remuxProgress'), 0);
});
