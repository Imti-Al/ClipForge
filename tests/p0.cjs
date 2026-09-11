const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mainContext } = require('./helpers/electron.cjs');

test('packaged binaries resolve only inside resources, never PATH', () => {
  const app = { isPackaged: true, whenReady: () => ({ then() {} }), on() {} };
  const loaded = mainContext({ app });
  assert.equal(loaded.load('media/binaries.js').getFFmpegPath().ffprobe, path.join('C:/installed/resources', 'ffmpeg', 'win32', 'ffprobe.exe'));
  const missing = mainContext({ app, fsSync: { existsSync: () => false } });
  assert.throws(() => missing.load('media/binaries.js').getFFmpegPath(), /Missing bundled/);
});

test('packaged startup ignores inherited VITE_DEV while development remains available', () => {
  for (const packaged of [false, true]) {
    const loaded = mainContext({
      app: { isPackaged: packaged, whenReady: () => ({ then() {} }), on() {} },
      process: { env: { VITE_DEV: '1' } },
    });
    assert.equal(loaded.evaluate('isDev'), !packaged);
  }
});

test('development probing and encoding share bundled resolver', async () => {
  let executable;
  const loaded = mainContext({ execFile: (exe, args, options, callback) => { executable = exe; callback(null, '{}'); } });
  await loaded.load('media/probe.js').ffprobeJSON('C:/video.mp4');
  assert.equal(executable, loaded.load('media/binaries.js').getFFmpegPath().ffprobe);
  assert.ok(path.isAbsolute(executable));
});

test('built HTML assets resolve next to dist/index.html for file URLs', () => {
  const html = fs.readFileSync('dist/index.html', 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2);
  for (const asset of assets) {
    assert.ok(asset.startsWith('./'), asset);
    assert.ok(fs.existsSync(path.join('dist', asset)), asset);
  }
});

module.exports = { mainContext };

test('existing export/remux paths reject before any FFmpeg process starts', async () => {
  let spawned = false;
  const loaded = mainContext({ fs: { lstat: async () => ({}) }, spawn: () => { spawned = true; } });
  for (const name of ['exportVideo', 'remuxVideo']) {
    const result = await loaded.handlers.get(name)({}, { inputPath: 'C:/in.mp4', outputPath: 'C:/out.mp4', containerFormat: 'mp4' });
    assert.equal(result.success, false);
    assert.equal(result.code, 'OUTPUT_EXISTS');
    assert.match(result.error, /OUTPUT_EXISTS/);
  }
  assert.equal(spawned, false);
});

test('MKV selects matroska and all outputs use no-overwrite; unsupported containers reject', async () => {
  const { EventEmitter } = require('node:events');
  const commands = [];
  const loaded = mainContext({
    fs: { lstat: async () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } },
    spawn: (exe, args) => { commands.push(args); const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stdout = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child; },
  });
  const opts = { inputPath: 'C:/in.mp4', outputPath: 'C:/out.mkv', containerFormat: 'mkv', duration: 2, mode: 'crf', crfValue: 23, preset: 'medium' };
  assert.equal((await loaded.handlers.get('exportVideo')({}, opts)).success, true);
  assert.equal((await loaded.handlers.get('remuxVideo')({}, { ...opts, outputPath: 'C:/out.mp4' })).success, true);
  assert.equal(commands[0][commands[0].indexOf('-f') + 1], 'matroska');
  for (const args of commands) { assert.ok(args.includes('-n')); assert.ok(!args.includes('-y')); }
  const unsupported = await loaded.handlers.get('exportVideo')({}, { ...opts, containerFormat: 'webm' });
  assert.equal(unsupported.success, false);
  assert.match(unsupported.error, /supports MP4 or MKV/);
});

test('project writes serialize across sidecar/manual entry points and survive a failed write', async () => {
  let release;
  const operations = [];
  const loaded = mainContext({ fs: {
    writeFile: async (p, data) => {
      operations.push(JSON.parse(data).testSequence);
      if (JSON.parse(data).testSequence === 3) throw new Error('Disk full');
      if (operations.length === 1) await new Promise(resolve => { release = resolve; });
    }, rename: async () => {},
  } });
  const first = loaded.handlers.get('projectSaveSidecar')(null, 'C:/v.mp4', { testSequence: 1 });
  const second = loaded.handlers.get('projectSaveFile')(null, 'C:/v-proj.clipforge', { testSequence: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(operations, [1]); release();
  await Promise.all([first, second]); assert.deepEqual(operations, [1, 2]);
  const failed = loaded.handlers.get('projectSaveSidecar')(null, 'C:/v.mp4', { testSequence: 3 });
  const recovered = loaded.handlers.get('projectSaveFile')(null, 'C:/v-proj.clipforge', { testSequence: 4 });
  assert.equal((await failed).success, false);
  assert.equal((await recovered).success, true);
});
