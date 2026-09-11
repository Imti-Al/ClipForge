const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

function mainContext(overrides = {}) {
  const handlers = new Map();
  const dependencies = {
    fs: {}, fsSync: { existsSync: () => true },
    app: { isPackaged: false, whenReady: () => ({ then() {} }), on() {} },
    BrowserWindow: class {}, protocol: {}, dialog: {}, spawn() {}, execFile() {},
    process: { env: {}, platform: 'win32', resourcesPath: 'C:/installed/resources', cwd: () => process.cwd() },
    ...overrides,
  };
  const mocks = {
    electron: { ...dependencies, ipcMain: { handle: (name, fn) => {
      if (handlers.has(name)) throw new Error('Duplicate IPC handler: ' + name);
      handlers.set(name, fn);
    } } },
    'node:fs/promises': dependencies.fs,
    'node:fs': dependencies.fsSync,
    'node:child_process': { spawn: dependencies.spawn, execFile: dependencies.execFile },
    'node:os': { platform: () => 'win32', tmpdir: () => 'C:/temp' },
  };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve('electron', relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    const context = vm.createContext({
      module, exports: module.exports, console, Buffer, URL, process: dependencies.process,
      setTimeout, clearTimeout,
      require: name => name in mocks ? mocks[name] : name.startsWith('.')
        ? load(path.relative(path.resolve('electron'), path.resolve(path.dirname(filename), name))) : require(name),
    });
    cache.set(filename, { module, context, get exports() { return module.exports; } });
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInContext(code, context, { filename });
    return module.exports;
  }
  load('main.js');
  return { handlers, load, evaluate: code => vm.runInContext(code, cache.get(path.resolve('electron/main.js')).context) };
}

module.exports = { mainContext };
