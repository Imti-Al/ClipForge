// Real bundled FFmpeg processes and filesystem; Electron lifecycle is stubbed.
// Run from the repository root: node tests/tools/media-lifecycle-smoke.cjs
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { mainContext } = require('../helpers/electron.cjs');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-lifecycle-'));
  const children = [], rows = [];
  const loaded = mainContext({ fs, fsSync, os: { ...os, tmpdir: () => directory }, execFile: cp.execFile,
    spawn: (...args) => { const child = cp.spawn(...args); children.push(child); return child; },
  });
  const { ffmpeg } = loaded.load('media/binaries.js').getFFmpegPath();
  const source = path.join(directory, 'source.mkv');
  await promisify(cp.execFile)(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-n', source], { windowsHide: true });
  const service = loaded.load('media/export.js'), remux = loaded.load('media/remux.js');
  const jobs = loaded.load('media/jobs.js').createJobManager();
  const capabilities = await loaded.load('media/capabilities.js').getEncoderCapabilities();
  const defaults = { inputPath: source, duration: 6, startTime: 1, containerFormat: 'mp4', mode: 'crf', crfValue: 23,
    preset: 'medium', targetSize: 1, useGPU: false, copyAudio: false };
  for (const spec of [
    { name: 'cpu-success', mode: 'crf' }, { name: 'two-pass-success', mode: 'target' },
    { name: 'cpu-cancel', cancelPass: 1 }, { name: 'analysis-cancel', mode: 'target', cancelPass: 1 },
    { name: 'second-pass-cancel', mode: 'target', cancelPass: 2 },
    { name: 'remux-success', remux: true }, { name: 'remux-cancel', remux: true, cancelPass: 1 },
    ...(capabilities.nvenc ? [{ name: 'nvenc-success', useGPU: true }, { name: 'nvenc-cancel', useGPU: true, cancelPass: 1 }] : []),
  ]) {
    const outputPath = path.join(directory, spec.name + '.mp4');
    let requested = false;
    const execute = spec.remux ? remux.remuxVideo : service.exportVideo;
    const operation = jobs.run(1, spec.name, signal => execute({ ...defaults, ...spec, outputPath }, progress => {
      assert.ok(progress.progress < 100);
      if (spec.cancelPass === progress.pass && !requested) { requested = true; jobs.cancel(1, spec.name); }
    }, signal));
    if (spec.cancelPass) {
      await assert.rejects(operation, { code: 'CANCELLED' });
      assert.equal(requested, true); await assert.rejects(fs.stat(outputPath), { code: 'ENOENT' });
    } else {
      await operation;
      const info = await loaded.load('media/probe.js').getVideoInfo(outputPath);
      assert.ok(info.duration > 0); rows.push({ name: spec.name, bytes: info.size, duration: info.duration });
    }
    assert.equal(jobs.size, 0);
    assert.equal((await fs.readdir(directory)).some(name => name.includes('clipforge-pass-') || name.includes('.clipforge-output-')), false);
    if (spec.cancelPass) rows.push({ name: spec.name, result: 'CANCELLED; no output or temporary files' });
  }
  const failure = path.join(directory, 'failed.mp4');
  await assert.rejects(service.exportVideo({ ...defaults, inputPath: path.join(directory, 'missing.mkv'), copyAudio: false, outputPath: failure }), /failed/);
  await assert.rejects(fs.stat(failure), { code: 'ENOENT' });
  const existing = path.join(directory, 'existing.mp4'); await fs.writeFile(existing, 'preserve');
  await assert.rejects(service.exportVideo({ ...defaults, outputPath: existing }), /OUTPUT_EXISTS/);
  assert.equal(await fs.readFile(existing, 'utf8'), 'preserve');
  const shutdownOutput = path.join(directory, 'shutdown.mp4');
  let start;
  const started = new Promise(resolve => { start = resolve; });
  const active = jobs.run(1, 'shutdown', signal => service.exportVideo({ ...defaults, outputPath: shutdownOutput, preset: 'veryslow' }, () => start(), signal));
  const stopped = assert.rejects(active, { code: 'CANCELLED' });
  await started; await jobs.shutdown(); await stopped;
  await assert.rejects(fs.stat(shutdownOutput), { code: 'ENOENT' });
  for (const child of children) assert.ok(child.exitCode !== null || child.signalCode !== null, `Child ${child.pid} is still running`);
  assert.equal((await fs.readdir(directory)).some(name => name.startsWith('.clipforge') || name.startsWith('clipforge-pass')), false);
  const report = { directory, nvenc: capabilities.nvenc, rows, failureCleanup: true, collisionPreserved: true, shutdownChildrenReaped: children.length };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
