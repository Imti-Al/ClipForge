const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mainContext } = require('./helpers/electron.cjs');
const missing = async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };
const audioInfo = { streams: [{ codec_type: 'audio', codec_name: 'aac', bit_rate: '192000' }] };
const settings = { inputPath: 'C:/in.mp4', outputPath: 'C:/out.mp4', duration: 8, startTime: 3,
  containerFormat: 'mp4', mode: 'target', targetSize: 2, preset: 'medium', copyAudio: false };
const tick = () => new Promise(resolve => setImmediate(resolve));
function child() {
  const proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); return proc;
}
function harness(extra = {}) {
  const commands = [], children = [], removed = [];
  let directories = 0;
  const loaded = mainContext({
    fs: { lstat: missing, link: async () => {}, mkdtemp: async prefix => `${prefix}${++directories}`, rm: async dir => removed.push(dir) },
    execFile: (_exe, args, _opts, done) => done(null, args.includes('-show_streams') ? JSON.stringify(audioInfo) : '', ''),
    spawn: (_exe, args) => { commands.push(args); const proc = child(); children.push(proc); return proc; },
    ...extra,
  });
  return { ...loaded, commands, children, removed };
}

test('target budget reserves AAC, source copy bitrate, mux/safety and selected duration in decimal MB', async () => {
  const { targetBudget } = await import('../electron/media/budget.js');
  const aac = targetBudget(settings, audioInfo);
  assert.equal(aac.requestedBytes, 2000000); assert.equal(aac.audioBitrate, 128000);
  assert.equal(aac.videoBitrate, 1812000); assert.equal(aac.expectedBytes, 1960000);
  const copied = targetBudget({ ...settings, copyAudio: true }, audioInfo);
  assert.equal(copied.audioBitrate, 192000); assert.equal(copied.videoBitrate, 1748000);
  assert.ok(targetBudget({ ...settings, useGPU: true }, audioInfo).videoBitrate < aac.videoBitrate);
  assert.ok(targetBudget({ ...settings, duration: 4 }, audioInfo).videoBitrate > aac.videoBitrate);
  assert.equal(targetBudget(settings, { streams: [] }).audioBitrate, 0);
  assert.equal(targetBudget({ ...settings, copyAudio: true }, { streams: [{ codec_type: 'audio', tags: { BPS: '256000' } }] }).audioBitrate, 256000);
  assert.throws(() => targetBudget({ ...settings, copyAudio: true }, { streams: [{ codec_type: 'audio' }] }), /unknown/);
  assert.throws(() => targetBudget({ ...settings, duration: 1000 }, audioInfo), /too small/);
  for (const targetSize of [NaN, Infinity, 0, -1]) assert.throws(() => targetBudget({ ...settings, targetSize }, audioInfo));
});

test('two-pass export is one promise; shares unique log scope, trims both passes and cleans up', async () => {
  const h = harness(), events = [];
  let resolved = false;
  const operation = h.load('media/export.js').exportVideo(settings, data => events.push(data)).then(() => { resolved = true; });
  await tick(); assert.equal(h.children.length, 1);
  h.children[0].stdout.emit('data', 'out_time_us=8000000\nspeed=2x\nprogress=end\n');
  assert.equal(events[0].progress, 50); assert.equal(events[0].etaSeconds, 4);
  h.children[0].emit('close', 0);
  await tick(); assert.equal(resolved, false); assert.equal(h.children.length, 2);
  h.children[1].stdout.emit('data', 'out_time_us=8000000\nspeed=1x\nprogress=end\n');
  assert.equal(events[1].progress, 99); assert.equal(resolved, false);
  assert.equal(events[1].speed, 1.8);
  h.children[1].emit('close', 0); await operation;
  assert.equal(resolved, true); assert.equal(h.removed.length, 2);
  for (const args of h.commands) {
    assert.equal(args[args.indexOf('-ss') + 1], '3'); assert.equal(args[args.indexOf('-t') + 1], '8');
    assert.ok(args[args.indexOf('-passlogfile') + 1].startsWith(h.removed.find(dir => dir.includes('clipforge-pass-'))));
  }
  assert.ok(h.commands[0].includes('-an')); assert.ok(h.commands[1].includes('-n'));
});

test('pass failures and a collision appearing during pass 1 reject and clean log files', async () => {
  for (const failPass of [1, 2]) {
    const h = harness(); const operation = h.load('media/export.js').exportVideo(settings);
    const rejection = assert.rejects(operation, /failed with code 1/);
    await tick();
    if (failPass === 2) { h.children[0].emit('close', 0); await tick(); }
    h.children[failPass - 1].emit('close', 1); await rejection;
    assert.equal(h.removed.length, failPass); assert.equal(h.children.length, failPass);
  }
  let checks = 0;
  const h = harness({ fs: { lstat: async () => ++checks === 1 ? missing() : {},
    mkdtemp: async () => 'C:/temp/clipforge-pass-race', rm: async () => {} } });
  const operation = h.load('media/export.js').exportVideo(settings);
  const rejection = assert.rejects(operation, /OUTPUT_EXISTS/);
  await tick(); h.children[0].emit('close', 0); await rejection;
  assert.equal(h.children.length, 1);
});

test('simultaneous two-pass exports never share passlog directories', async () => {
  const h = harness();
  const first = h.load('media/export.js').exportVideo(settings);
  const second = h.load('media/export.js').exportVideo({ ...settings, outputPath: 'C:/second.mp4' });
  await tick();
  const logs = h.commands.map(args => args[args.indexOf('-passlogfile') + 1]);
  assert.notEqual(logs[0], logs[1]);
  h.children[0].emit('close', 0); h.children[1].emit('close', 0); await tick();
  h.children[2].emit('close', 0); h.children[3].emit('close', 0);
  await Promise.all([first, second]); assert.equal(new Set(h.removed).size, 4);
});

test('structured progress survives split lines, smooths speed, clamps regressions and bounds errors', async () => {
  const h = harness(), events = [];
  const running = h.load('media/ffmpegRunner.js').runFFmpeg([], { duration: 10, onProgress: data => events.push(data) });
  const rejected = assert.rejects(running, error => error.message.length < 66000 && error.message.endsWith('recent failure'));
  const proc = h.children[0];
  proc.stdout.emit('data', 'out_time_u'); proc.stdout.emit('data', 's=2000000\nspeed=2x\nprogress=continue\nout_time_us=1000000\nspeed=10x\nprogress=continue\n');
  assert.equal(events[0].progress, 20); assert.equal(events[1].progress, 20);
  assert.equal(events[1].speed, 3.6); assert.ok(events[1].etaSeconds > 2);
  proc.stdout.emit('data', 'out_time_us=12000000\nspeed=N/A\nprogress=end\n');
  assert.equal(events[2].progress, 99);
  proc.stderr.emit('data', 'old'.repeat(100000)); proc.stderr.emit('data', 'recent failure');
  proc.emit('close', 1); await rejected;
});

test('NVENC capability initializes the encoder once; failures prevent GPU export without affecting CPU', async () => {
  let probes = 0;
  const h = harness({ execFile: (_exe, args, opts, done) => {
    if (args.includes('-show_streams')) return done(null, JSON.stringify(audioInfo));
    probes++; assert.equal(opts.timeout, 10000); assert.ok(args.includes('color=size=640x360:rate=30'));
    done(new Error('no device'), '', 'No capable devices found');
  } });
  const service = h.load('media/capabilities.js');
  const results = await Promise.all([service.getEncoderCapabilities(), service.getEncoderCapabilities()]);
  assert.equal(probes, 1); assert.equal(results[0].nvenc, false);
  await assert.rejects(h.load('media/export.js').exportVideo({ ...settings, useGPU: true }), /Use CPU/);
  assert.equal(h.children.length, 0); assert.equal(probes, 1);
  const cpu = h.load('media/export.js').exportVideo({ ...settings, mode: 'crf' });
  await tick(); h.children[0].emit('close', 0); await cpu;
});

test('NVENC target uses bounded VBR and one process; estimate and encode share budget', async () => {
  const h = harness();
  const opts = { ...settings, useGPU: true, copyAudio: true };
  const estimate = await h.load('media/export.js').getExportEstimate(opts);
  const operation = h.load('media/export.js').exportVideo(opts);
  await tick(); const args = h.commands[0];
  for (const flag of ['-b:v', '-maxrate']) assert.equal(args[args.indexOf(flag) + 1], String(estimate.videoBitrate));
  assert.equal(args[args.indexOf('-rc') + 1], 'vbr'); assert.equal(args[args.indexOf('-multipass') + 1], 'fullres');
  assert.ok(!args.includes('-pass')); assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  h.children[0].emit('close', 0); await operation; assert.equal(h.children.length, 1);
});
