const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mainContext } = require('./helpers/electron.cjs');
const missing = async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };

test('encoder arguments use codec-specific quality, presets and target rate control', async () => {
  const { ENCODERS, encoderFor, encoderArgs } = await import('../electron/media/encoders.js');
  assert.equal(ENCODERS.length, 12);
  assert.equal(encoderFor({ useGpu: true }).id, 'h264_nvenc');
  assert.throws(() => encoderFor({ encoderId: 'unknown' }), /Unknown/);
  for (const encoder of ENCODERS) {
    const quality = encoderArgs(encoder, { mode: 'crf' });
    assert.equal(quality[1], encoder.id);
    const flag = { x264: '-crf', x265: '-crf', svt: '-crf', nvenc: '-cq', qsv: '-global_quality', amf: '-qp_i' }[encoder.family];
    assert.equal(quality[quality.indexOf(flag) + 1], String(encoder.quality.default));
    if (encoder.hardware) assert.ok(!quality.includes('-crf'));
    assert.throws(() => encoderArgs(encoder, { crfValue: encoder.quality.max + 1 }), /Invalid/);
    const target = encoderArgs(encoder, { mode: 'target' }, 1200000);
    assert.equal(target[target.indexOf('-b:v') + 1], '1200000');
    assert.ok(!target.includes(flag));
  }
});

test('runtime capability probes cache results and independently gate quality and target modes', async () => {
  let calls = 0;
  const loaded = mainContext({ execFile: (_exe, args, options, done) => {
    calls++; assert.equal(options.timeout, 10000);
    const target = args.includes('-maxrate');
    done(target ? null : new Error('ICQ unavailable'), '', target ? '' : 'unsupported rate control');
  } });
  const service = loaded.load('media/capabilities.js');
  const [a, b] = await Promise.all([service.getEncoderCapability('av1_qsv'), service.getEncoderCapability('av1_qsv')]);
  assert.equal(a, b); assert.equal(calls, 2);
  assert.equal(a.modes.crf, false); assert.equal(a.modes.target, true);
  await assert.rejects(service.requireEncoder('av1_qsv', 'crf'), /unavailable/);
  await service.requireEncoder('av1_qsv', 'target'); assert.equal(calls, 2);
});

test('cancelling during a capability probe settles the job without launching an export', async () => {
  let finish;
  const loaded = mainContext({ execFile: (_exe, _args, _options, done) => { finish = done; } });
  const controller = new AbortController();
  const pending = loaded.load('media/capabilities.js').requireEncoder('libx264', 'crf', controller.signal);
  const rejected = assert.rejects(pending, { code: 'CANCELLED' }); controller.abort(); await rejected;
  finish(new Error('closed'), '', '');
});

test('keyframe ranges expand outward and reject unknown boundaries', () => {
  const { alignRange } = mainContext().load('media/keyframes.js');
  const plan = alignRange(1, 5, 10, [0, 2, 4], [4, 6, 8]);
  assert.equal(plan.startTime, 0); assert.equal(plan.endTime, 6);
  assert.equal(alignRange(2, 10, 10, [0, 2], []).endTime, 10);
  assert.throws(() => alignRange(1, 5, 10, [], [6]), /No usable/);
  assert.throws(() => alignRange(1, 5, 10, [0], []), /No usable/);
});

test('keyframe windows are bounded, timestamp-normalized, cached and invalidated by file changes', async () => {
  let probes = 0, modified = 1;
  const loaded = mainContext({ fs: { stat: async () => ({ size: 100, mtimeMs: modified }) }, execFile: (_exe, args, _options, done) => {
    probes++;
    if (args.includes('-show_streams')) return done(null, JSON.stringify({ format: { duration: '1000', start_time: '5' }, streams: [] }));
    assert.equal(args[args.indexOf('-read_intervals') + 1], '5%65');
    done(null, JSON.stringify({ frames: [{ key_frame: 1, best_effort_timestamp_time: '5' }, { key_frame: 1, best_effort_timestamp_time: '7' }] }));
  } });
  const service = loaded.load('media/keyframes.js');
  const first = await service.getKeyframes('source.mp4', 8); assert.equal(first.times[0], 0); assert.equal(first.times[1], 2);
  await service.getKeyframes('source.mp4', 9); assert.equal(probes, 2);
  modified++; await service.getKeyframes('source.mp4', 9); assert.equal(probes, 4);
});

test('fast copy preserves compatible audio/subtitles and rejects incompatible audio/container pairs', () => {
  const { copyStreams } = mainContext().load('media/trim.js');
  const source = { streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc' },
    { index: 1, codec_type: 'audio', codec_name: 'aac' }, { index: 2, codec_type: 'subtitle', codec_name: 'subrip' }] };
  const mkv = copyStreams(source, 'mkv'); assert.equal(mkv.indices.length, 3);
  const mp4 = copyStreams(source, 'mp4'); assert.equal(mp4.indices.length, 2); assert.match(mp4.omitted[0], /subrip/);
  source.streams[1].codec_name = 'vorbis'; assert.throws(() => copyStreams(source, 'mp4'), /Cannot copy/);
  assert.equal(copyStreams(source, 'mkv').indices.length, 3);
});

test('batch plans keep source ranges and deterministic indexed names and preflight every output', async () => {
  const existing = new Set();
  const loaded = mainContext({ fs: { stat: async () => ({ size: 100, mtimeMs: 1 }), lstat: async file => existing.has(file) ? {} : missing() },
    execFile: (_exe, _args, _options, done) => done(null, '{"format":{"duration":"20"},"streams":[]}'),
  });
  const service = loaded.load('media/exportPlan.js');
  const request = { inputPath: 'source.mp4', outputPath: 'C:/output/clip.mp4', containerFormat: 'mp4', method: 'encode',
    clips: [{ id: 'a', name: 'same:name', start: 1, end: 4 }, { id: 'b', name: 'same:name', start: 7, end: 12 }] };
  const plan = await service.getExportPlan(request);
  assert.equal(path.basename(plan[0].outputPath), 'clip-001-same_name.mp4');
  assert.equal(path.basename(plan[1].outputPath), 'clip-002-same_name.mp4');
  assert.equal(plan[1].startTime, 7); assert.equal(plan[1].duration, 5);
  existing.add(plan[1].outputPath); await assert.rejects(service.getExportPlan(request), /OUTPUT_EXISTS/);
});
