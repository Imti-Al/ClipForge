// Real bundled FFmpeg/ffprobe processes; only Electron's lifecycle is stubbed.
// Run from repository root: node tests/tools/media-benchmark.cjs
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { mainContext } = require('../helpers/electron.cjs');
const exec = promisify(cp.execFile);

async function main() {
  const gpuOnly = process.argv.includes('--gpu-only');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-accuracy-'));
  console.log('BENCHMARK_DIRECTORY', directory);
  const loaded = mainContext({ fs, fsSync, os, spawn: cp.spawn, execFile: cp.execFile });
  const { ffmpeg, ffprobe } = loaded.load('media/binaries.js').getFFmpegPath();
  const run = args => exec(ffmpeg, ['-v', 'error', ...args], { windowsHide: true, maxBuffer: 1048576 });
  const source = path.join(directory, 'source.mp4');
  await run(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:sample_rate=48000:seed=42',
    '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-n', source]);
  const capabilities = await loaded.load('media/capabilities.js').getEncoderCapabilities();
  const service = loaded.load('media/export.js');
  const rows = [];
  const progressChecks = [];
  for (const gpu of [...(gpuOnly ? [] : [false]), ...(capabilities.nvenc ? [true] : [])]) {
    for (const [targetSize, duration, copyAudio, containerFormat] of [[1, 4, false, 'mp4'], [2, 10, true, 'mp4'], [4, 16, false, 'mkv']]) {
      for (const revision of ['before', 'after']) {
        const name = `${gpu ? 'nvenc' : 'cpu'}-${targetSize}MB-${revision}.${containerFormat}`;
        const outputPath = path.join(directory, name);
        const options = { inputPath: source, outputPath, startTime: 2, duration, targetSize, copyAudio, containerFormat,
          mode: 'target', preset: 'medium', useGPU: gpu };
        const started = Date.now();
        if (revision === 'before') {
          // Reproduce checkpoint 1ab5a23 target arguments, including the old unit conversion.
          await run(['-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-ss', '2', '-t', String(duration),
            '-c:v', gpu ? 'h264_nvenc' : 'libx264', '-preset', gpu ? 'p5' : 'medium',
            '-b:v', `${Math.floor(targetSize * 8 * 1024 / duration)}k`,
            ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']),
            '-f', containerFormat === 'mkv' ? 'matroska' : containerFormat, '-n', outputPath]);
        } else {
          const progress = [];
          await service.exportVideo(options, event => progress.push(event));
          assert.ok(progress.length > 0);
          assert.ok(progress.every((event, index) => event.progress < 100 && (!index || event.progress >= progress[index - 1].progress)));
          assert.deepEqual([...new Set(progress.map(event => event.pass))], gpu ? [1] : [1, 2]);
          progressChecks.push({ name, events: progress.length, finalProgress: progress.at(-1).progress, passes: gpu ? 1 : 2 });
        }
        const { stdout } = await exec(ffprobe, ['-v', 'quiet', '-show_format', '-show_streams', '-of', 'json', outputPath], { windowsHide: true });
        const metadata = JSON.parse(stdout);
        assert.ok(Math.abs(Number(metadata.format.duration) - duration) < 0.1);
        assert.equal(metadata.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
        const actualBytes = (await fs.stat(outputPath)).size;
        rows.push({ revision, mode: gpu ? 'NVENC VBR' : revision === 'after' ? 'CPU two-pass' : 'CPU one-pass', targetMB: targetSize,
          actualBytes, deviationPercent: Number(((actualBytes / (targetSize * 1000000) - 1) * 100).toFixed(3)),
          selectedDuration: duration, outputDuration: Number(metadata.format.duration), audio: copyAudio ? 'copied AAC 192k source' : 'AAC 128k encode',
          container: containerFormat, elapsedSeconds: (Date.now() - started) / 1000 });
        console.log('RESULT', JSON.stringify(rows.at(-1)));
      }
    }
  }
  for (const gpu of [...(gpuOnly ? [] : [false]), ...(capabilities.nvenc ? [true] : [])]) {
    const events = [];
    await service.exportVideo({ inputPath: source, outputPath: path.join(directory, gpu ? 'cq.mp4' : 'crf.mp4'),
      startTime: 3, duration: 2, mode: 'crf', crfValue: 23, useGPU: gpu, copyAudio: true, containerFormat: 'mp4' }, event => events.push(event));
    assert.ok(events.length && events.every(event => event.progress < 100 && event.pass === 1));
  }
  const inputPath = path.join(directory, `${gpuOnly ? 'nvenc' : 'cpu'}-4MB-after.mkv`), outputPath = path.join(directory, 'remux.mp4');
  const events = [];
  await loaded.load('media/remux.js').remuxVideo({ inputPath, outputPath, duration: 16 }, event => events.push(event));
  assert.ok(events.length && events.every(event => event.progress < 100));
  await assert.rejects(loaded.load('media/remux.js').remuxVideo({ inputPath, outputPath, duration: 16 }), /OUTPUT_EXISTS/);
  const report = { directory, capabilities, source: 'Generated testsrc2 1280x720 30fps + seeded pink-noise AAC 192k; 20 seconds',
    rows, progressChecks, extraChecks: ['real CPU CRF', 'real NVENC CQ if available', 'real MKV remux', 'existing remux collision'] };
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log('REPORT', path.join(directory, 'results.json'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
