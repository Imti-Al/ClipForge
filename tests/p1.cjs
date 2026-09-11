const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mainContext } = require('./helpers/electron.cjs');

test('extracted probe preserves normalization and rejects malformed JSON internally', async () => {
  const raw = { format: { duration: '4', size: '400' }, streams: [
    { codec_type: 'video', codec_name: 'h264', avg_frame_rate: '0/0', r_frame_rate: '30000/1001', width: '640', height: '360' },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
  ] };
  const loaded = mainContext({ execFile: (_exe, _args, _options, done) => done(null, JSON.stringify(raw)) });
  const info = await loaded.load('media/probe.js').getVideoInfo('safe-file:C:/source.mp4');
  assert.equal(info.duration, 4);
  assert.equal(info.bitrate, 800);
  assert.equal(info.video.fps, 30000 / 1001);
  assert.equal(info.audio.sampleRate, 48000);
  const invalid = mainContext({ execFile: (_exe, _args, _options, done) => done(null, '{') });
  await assert.rejects(invalid.load('media/probe.js').ffprobeJSON('source.mp4'));
});

test('extracted runner preserves NVENC arguments and export/remux progress', async () => {
  const commands = [], events = [];
  const loaded = mainContext({
    execFile: (_exe, _args, _options, done) => done(null, '', ''),
    fs: { lstat: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } },
    spawn: (_exe, args) => {
      commands.push(args);
      const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stdout = new EventEmitter();
      queueMicrotask(() => { child.stdout.emit('data', 'out_time_us=1000000\nspeed=2.0x\nprogress=continue\n'); child.emit('close', 0); });
      return child;
    },
  });
  const options = { inputPath: 'C:/input.mp4', outputPath: 'C:/out.mp4', duration: 2, containerFormat: 'mp4', useGPU: true, mode: 'crf', crfValue: 19, preset: 'slow' };
  await loaded.load('media/export.js').exportVideo(options, data => events.push(data));
  await loaded.load('media/remux.js').remuxVideo(options, data => events.push(data));
  assert.ok(commands[0].includes('h264_nvenc'));
  assert.equal(commands[0][commands[0].indexOf('-preset') + 1], 'p6');
  assert.equal(commands[0][commands[0].indexOf('-cq') + 1], '19');
  assert.equal(events[0].progress, 50); assert.equal(events[0].speed, 2);
  assert.equal(events[1].inputPath, options.inputPath); assert.equal(events[1].progress, 50);
});

test('project migration preserves current segments, metadata and unknown fields', async () => {
  const { migrateProject } = await import('../electron/projects/schema.js');
  const original = { version: '1.0.0', createdAt: '2020-01-01', custom: { keep: true }, segments: [
    { id: 'one', start: 1, end: 2 }, { id: 'two', start: 3, end: 4 },
  ], activeSegmentId: 'two' };
  assert.deepEqual(migrateProject(original), original);
  const legacy = { version: '0.1.0', createdAt: '2020-01-01', selection: { inTime: 2, outTime: 5 } };
  const migrated = migrateProject(legacy);
  assert.equal(migrated.version, '0.1.0'); assert.equal(migrated.createdAt, legacy.createdAt);
  assert.equal(migrated.segments[0].start, 2); assert.equal(migrated.segments[0].end, 5);
  assert.equal(legacy.segments, undefined);
  assert.deepEqual(migrateProject(migrated), migrated);
  assert.equal(migrateProject({}).version, '1.0.0');
  assert.throws(() => migrateProject([]), /JSON object/);
  assert.throws(() => migrateProject({ version: '2.0.0' }), /Unsupported project version/);
  assert.throws(() => migrateProject({ selection: 'broken' }), /selection/);
});

test('real project store writes .llc/.clipforge atomically and retains source and metadata', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { createProjectStore } = await import('../electron/projects/store.js');
  const prefix = path.join(os.tmpdir(), 'clipforge-p1-');
  const directory = await fs.mkdtemp(prefix);
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); await fs.rm(directory, { recursive: true, force: true }); });
  const store = createProjectStore({ isTempImportPath: source => source.startsWith('temp:') });
  const source = path.join(directory, 'source.mp4');
  await fs.writeFile(source, 'original');
  const data = { version: '0.1.0', createdAt: '2020-01-01', sourceVideo: { path: source }, selection: { inTime: 0, outTime: 4 } };
  const sidecar = await store.saveSidecar(source, data);
  const explicit = path.join(directory, 'chosen.llc');
  await store.saveFile(explicit, data);
  const read = await store.read(explicit);
  assert.equal(read.version, data.version); assert.equal(read.createdAt, data.createdAt);
  assert.equal(read.sourceVideo.path, source); assert.equal(read.segments.length, 1);
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.equal(await store.exists(explicit + '.tmp'), false);
  await assert.rejects(store.saveSidecar('temp:source.mp4', data), /temporary/);
  await assert.rejects(store.saveFile(source, data), /project file/);
  store.setDeleteOnExit(sidecar, true); store.setDeleteOnExit(explicit, true); store.setDeleteOnExit(explicit, false);
  await store.cleanupOnExit();
  assert.equal(await store.exists(sidecar), false); assert.equal(await store.exists(explicit), true);
});
