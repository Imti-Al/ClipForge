const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { mainContext } = require('./helpers/electron.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const absent = async file => assert.rejects(fs.stat(file), { code: 'ENOENT' });

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-reliability-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('jobs register immediately, restrict cancellation to the owner, and remove only settled jobs', async () => {
  const { createJobManager, checkCancelled } = await import('../electron/media/jobs.js');
  const jobs = createJobManager(), a = deferred(), b = deferred();
  const first = jobs.run(1, 'a', async signal => { await a.promise; checkCancelled(signal); });
  const rejected = assert.rejects(first, { code: 'CANCELLED' });
  const second = jobs.run(2, 'b', async signal => { await b.promise; checkCancelled(signal); return 'completed'; });
  assert.equal(jobs.size, 2);
  await assert.rejects(jobs.run(1, 'a', () => {}), { code: 'INVALID_JOB' });
  assert.equal(jobs.cancel(2, 'a'), false);
  assert.equal(jobs.cancel(1, 'a'), true);
  assert.equal(jobs.size, 2);
  a.resolve(); await rejected;
  assert.equal(jobs.size, 1);
  assert.equal(jobs.cancel(1, 'a'), false);
  b.resolve(); assert.equal(await second, 'completed'); assert.equal(jobs.size, 0);
});

test('runner cancellation kills only its child, waits for close, and never reports success on exit zero', async () => {
  const children = [];
  const loaded = mainContext({ spawn: () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kills = []; child.kill = signal => child.kills.push(signal); children.push(child); return child;
  } });
  const { runFFmpeg } = loaded.load('media/ffmpegRunner.js');
  const controller = new AbortController(); let settled = false;
  const first = runFFmpeg([], { duration: 10, signal: controller.signal });
  first.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(first, { code: 'CANCELLED' });
  const second = runFFmpeg([], { duration: 10 });
  controller.abort(); await tick();
  assert.equal(settled, false); assert.equal(children[0].kills.length, 1); assert.equal(children[1].kills.length, 0);
  children[0].emit('close', 0); await rejected;
  children[1].emit('close', 0); await second;
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(runFFmpeg([], { signal: aborted.signal }), { code: 'CANCELLED' });
  assert.equal(children.length, 2);
});

test('publication is a non-cancellable commit point, not a falsely cancelled successful job', async () => {
  const { createJobManager, beginPublication } = await import('../electron/media/jobs.js');
  const jobs = createJobManager(), gate = deferred();
  const operation = jobs.run(1, 'publishing', async signal => { beginPublication(signal); await gate.promise; return 'published'; });
  await tick(); assert.equal(jobs.cancel(1, 'publishing'), false);
  gate.resolve(); assert.equal(await operation, 'published');
});

test('runner escalates cancellation for an unresponsive child before settling', async () => {
  const signals = [];
  const loaded = mainContext({ spawn: () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = signal => { signals.push(signal); if (signal === 'SIGKILL') child.emit('close', null); };
    return child;
  } });
  const controller = new AbortController();
  const operation = loaded.load('media/ffmpegRunner.js').runFFmpeg([], { signal: controller.signal });
  const rejected = assert.rejects(operation, { code: 'CANCELLED' });
  controller.abort();
  // Keep the mocked test process alive; real child-process handles normally do this.
  await new Promise(resolve => setTimeout(resolve, 1100)); await rejected;
  assert.deepEqual(signals, [undefined, 'SIGKILL']);
});

test('shutdown cancels active jobs, awaits cleanup, rejects new work, and has a bounded wait', async () => {
  const { createJobManager, cancelled } = await import('../electron/media/jobs.js');
  const jobs = createJobManager(); let cleaned = false;
  const job = jobs.run(1, 'active', signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { cleaned = true; reject(cancelled()); });
  }));
  const rejected = assert.rejects(job, { code: 'CANCELLED' }); await tick();
  await jobs.shutdown(); await rejected;
  assert.equal(cleaned, true); assert.equal(jobs.size, 0);
  await assert.rejects(jobs.run(1, 'late', () => {}), { code: 'CLOSING' });
  const stuck = createJobManager(); stuck.run(1, 'stuck', () => new Promise(() => {})); await tick();
  await stuck.shutdown(10);
});

test('output staging cleans failure/cancellation, preserves collisions, and publishes successful bytes', async t => {
  const dir = await directory(t), output = path.join(dir, 'video.mp4');
  const { withOutput } = await import('../electron/media/output.js');
  await assert.rejects(withOutput(output, undefined, async file => { await fs.writeFile(file, 'partial'); throw new Error('encode failed'); }), /encode failed/);
  await absent(output); assert.deepEqual(await fs.readdir(dir), []);
  const controller = new AbortController();
  await assert.rejects(withOutput(output, controller.signal, async file => { await fs.writeFile(file, 'partial'); controller.abort(); }), { code: 'CANCELLED' });
  await absent(output); assert.deepEqual(await fs.readdir(dir), []);
  await assert.rejects(withOutput(output, undefined, async file => {
    await fs.writeFile(file, 'ours'); await fs.writeFile(output, 'someone else');
  }), { code: 'OUTPUT_EXISTS' });
  assert.equal(await fs.readFile(output, 'utf8'), 'someone else');
  assert.deepEqual(await fs.readdir(dir), ['video.mp4']);
  const completed = path.join(dir, 'complete.mp4');
  await withOutput(completed, undefined, file => fs.writeFile(file, 'complete'));
  assert.equal(await fs.readFile(completed, 'utf8'), 'complete');
});

test('output publication falls back to exclusive copy on volumes without hardlinks', async () => {
  let copied, removed;
  const loaded = mainContext({ fsSync: { ...fsSync }, fs: {
    mkdtemp: async () => 'temporary', link: async () => { throw Object.assign(new Error(), { code: 'ENOTSUP' }); },
    copyFile: async (...args) => { copied = args; }, rm: async dir => { removed = dir; },
  } });
  await loaded.load('media/output.js').withOutput('final.mp4', undefined, async () => {});
  assert.equal(copied[2], fsSync.constants.COPYFILE_EXCL); assert.equal(removed, 'temporary');
});

test('two-pass cancellation in either pass removes logs/output and cannot launch the next pass', async t => {
  const dir = await directory(t);
  for (const pass of [1, 2]) {
    const children = [], controller = new AbortController();
    const loaded = mainContext({ fs, fsSync, os: { ...os, tmpdir: () => dir },
      execFile: (_exe, _args, _opts, done) => done(null, '{"streams":[]}'),
      spawn: (_exe, args) => {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        child.kill = () => queueMicrotask(() => child.emit('close', 0));
        const log = args[args.indexOf('-passlogfile') + 1]; fsSync.writeFileSync(log + '-0.log', 'pass data');
        if (args.at(-1) !== '-') fsSync.writeFileSync(args.at(-1), 'partial');
        children.push(child); return child;
      },
    });
    const operation = loaded.load('media/export.js').exportVideo({ inputPath: 'input.mp4', outputPath: path.join(dir, 'out.mp4'),
      containerFormat: 'mp4', mode: 'target', targetSize: 1, duration: 5 }, undefined, controller.signal);
    const rejected = assert.rejects(operation, { code: 'CANCELLED' });
    const waitChildren = async count => {
      for (let i = 0; i < 1000 && children.length < count; i++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(children.length, count);
    };
    await waitChildren(1);
    if (pass === 2) { children[0].emit('close', 0); await waitChildren(2); }
    controller.abort(); await rejected;
    assert.equal(children.length, pass); assert.deepEqual(await fs.readdir(dir), []);
  }
});

test('chunked imports enforce bounded ordered writes, ownership, completion and interrupted cleanup', async t => {
  const dir = await directory(t);
  const loaded = mainContext({ fs, os: { tmpdir: () => dir } });
  const store = loaded.load('imports.js').createImportStore();
  const { chunkBytes } = await store.begin(1, 'one', '../video.mp4', 5);
  assert.equal(chunkBytes, 1024 * 1024);
  await assert.rejects(store.chunk(2, 'one', 0, Buffer.from('abc')), /no longer/);
  await assert.rejects(store.chunk(1, 'one', 1, Buffer.from('abc')), /Invalid/);
  await assert.rejects(store.chunk(1, 'one', 0, Buffer.alloc(chunkBytes + 1)), /Invalid/);
  const sliced = Buffer.from('!abc!').subarray(1, 4);
  await store.chunk(1, 'one', 0, sliced);
  await assert.rejects(store.finish(1, 'one'), /incomplete/);
  await store.chunk(1, 'one', 3, Buffer.from('de'));
  const complete = await store.finish(1, 'one');
  assert.equal(await fs.readFile(complete.tempPath, 'utf8'), 'abcde');
  await store.begin(1, 'two', 'unfinished.mkv', 100);
  await store.chunk(1, 'two', 0, Buffer.from('abc'));
  await store.abort(1, 'two');
  assert.equal((await fs.readdir(path.join(dir, 'ClipForgeImports'))).length, 1);
  // Moving a completed temporary source to permanent storage must not make cleanup delete it.
  const permanent = path.join(dir, 'permanent.mp4'); await fs.rename(complete.tempPath, permanent);
  await store.shutdown(); assert.equal(await fs.readFile(permanent, 'utf8'), 'abcde');
  assert.deepEqual(await fs.readdir(path.join(dir, 'ClipForgeImports')), []);
  await assert.rejects(store.begin(1, 'late', 'late', 1), /Invalid/);
});

test('aborting an import while creation is pending closes and removes its partial file', async t => {
  const dir = await directory(t), gate = deferred();
  const loaded = mainContext({ fs: { ...fs, mkdir: async (...args) => { await gate.promise; return fs.mkdir(...args); } }, os: { tmpdir: () => dir } });
  const store = loaded.load('imports.js').createImportStore();
  const begin = store.begin(1, 'pending', 'video.mp4', 20);
  const abort = store.abort(1, 'pending'); gate.resolve(); await Promise.all([begin, abort]);
  assert.deepEqual(await fs.readdir(path.join(dir, 'ClipForgeImports')), []);
});

test('Electron shutdown prevents quit until jobs and queued project writes have cleaned up', async () => {
  const listeners = new Map(), write = deferred(); let renamed = false, quit = 0;
  const loaded = mainContext({ app: { isPackaged: false, whenReady: () => ({ then() {} }), on: (name, fn) => listeners.set(name, fn), quit: () => quit++ },
    fs: { writeFile: () => write.promise, rename: async () => { renamed = true; } },
  });
  const save = loaded.handlers.get('projectSaveFile')({}, 'C:/project.clipforge', {});
  let prevented = false; listeners.get('will-quit')({ preventDefault() { prevented = true; } });
  await tick(); assert.equal(prevented, true); assert.equal(quit, 0);
  write.resolve(); await save; await tick(); assert.equal(renamed, true); assert.equal(quit, 1);
});

test('native window close requests a renderer flush before allowing the approved close', async () => {
  let window, requested = 0, closed = false;
  class Window extends EventEmitter {
    constructor() {
      super(); window = this;
      this.webContents = new EventEmitter(); this.webContents.id = 1;
      this.webContents.isDestroyed = () => false;
      this.webContents.send = channel => { assert.equal(channel, 'closeRequested'); requested++; };
    }
    loadFile() {}
    isDestroyed() { return closed; }
    close() {
      let prevented = false; this.emit('close', { preventDefault() { prevented = true; } });
      if (!prevented) { closed = true; this.emit('closed'); }
    }
    static fromWebContents() { return window; }
  }
  const loaded = mainContext({ BrowserWindow: Window }); loaded.evaluate('createWindow()');
  window.close(); assert.equal(requested, 1); assert.equal(closed, false);
  await loaded.handlers.get('closeWindow')({ sender: window.webContents }, false);
  assert.equal(closed, false); assert.equal(loaded.evaluate('pendingCloses.has(mainWindow)'), false);
  window.close(); assert.equal(requested, 2);
  const approved = await loaded.handlers.get('closeWindow')({ sender: window.webContents });
  assert.equal(approved.success, true);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(closed, true); assert.equal(requested, 2);
});

test('an unresponsive renderer has a bounded native-close fallback', () => {
  let window, fallback, destroyed = false;
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.webContents = new EventEmitter(); this.webContents.id = 9;
      this.webContents.isDestroyed = () => false; this.webContents.send = () => {}; }
    loadFile() {}
    isDestroyed() { return destroyed; }
    destroy() { destroyed = true; this.emit('closed'); }
  }
  const loaded = mainContext({ BrowserWindow: Window, setTimeout: (callback, ms) => {
    assert.equal(ms, 7000); fallback = callback; return 1;
  }, clearTimeout() {} });
  loaded.evaluate('createWindow()'); window.emit('close', { preventDefault() {} });
  assert.equal(destroyed, false); fallback(); assert.equal(destroyed, true);
});

test('shutdown aborts short probe children and blocks later probe creation', async () => {
  let signal, finish, calls = 0;
  const loaded = mainContext({ execFile: (_exe, _args, options, callback) => {
    calls++; signal = options.signal; finish = callback;
  } });
  const probe = loaded.load('media/probe.js').ffprobeJSON('source.mp4');
  const rejected = assert.rejects(probe);
  loaded.load('media/probeProcesses.js').stopProbes();
  assert.equal(signal.aborted, true); finish(new Error('aborted'));
  await rejected;
  await assert.rejects(loaded.load('media/probe.js').ffprobeJSON('later.mp4'), { code: 'CANCELLED' });
  assert.equal(calls, 1);
});

test('stale import cleanup removes abandoned directories but preserves another live process', async t => {
  const dir = await directory(t), root = path.join(dir, 'ClipForgeImports');
  for (const [name, pid] of [['import-abandoned', 111], ['import-live', 222]]) {
    const folder = path.join(root, name); await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, '.owner.json'), JSON.stringify({ pid }));
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000); await fs.utimes(folder, old, old);
  }
  const loaded = mainContext({ fs, os: { tmpdir: () => dir }, process: {
    env: {}, kill: pid => { if (pid === 111) throw Object.assign(new Error(), { code: 'ESRCH' }); },
  } });
  await loaded.load('files.js').cleanupOldTempFiles();
  assert.deepEqual(await fs.readdir(root), ['import-live']);
});
