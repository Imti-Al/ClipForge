import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { cleanSafeFile } from '../paths.js';
import { ffprobeJSON } from './probe.js';
import { assertOutputAvailable, runFFmpeg } from './ffmpegRunner.js';
import { AAC_BITRATE, targetBudget } from './budget.js';
import { requireEncoder } from './capabilities.js';
import { mediaFacts } from './keyframes.js';
import { encoderFor, encoderArgs } from './encoders.js';
import { fastTrim } from './trim.js';
import { withOutput } from './output.js';
import { checkCancelled } from './jobs.js';

function normalized(options) {
  const encoder = encoderFor(options);
  return { ...options,
    duration: Number(options.duration) > 0 ? Number(options.duration) : Number(options.endTime) - Number(options.startTime),
    useGPU: encoder.hardware,
    approximateRateControl: !encoder.twoPass,
  };
}

export async function getExportEstimate(options) {
  const info = options.encoderId ? (await mediaFacts(options.inputPath)).info : await ffprobeJSON(cleanSafeFile(options.inputPath));
  return targetBudget(normalized(options), info);
}

export async function exportVideo(options, onProgress, signal) {
  checkCancelled(signal);
  if (options.method === 'copy') return fastTrim(options, onProgress, signal);
  const settings = normalized(options);
  const encoder = encoderFor(options);
  const { duration, startTime, mode, copyAudio } = settings;
  const inputPath = cleanSafeFile(options.inputPath);
  const outputPath = options.outputPath ? path.normalize(options.outputPath) : '';
  const format = String(options.containerFormat || options.format || path.extname(outputPath).slice(1)).toLowerCase();
  if (!['mp4', 'mkv', 'matroska'].includes(format)) throw new Error('Export supports MP4 or MKV. Choose MP4 or MKV.');
  await assertOutputAvailable(inputPath, outputPath);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid export duration (segment length must be > 0)');
  if (!['crf', 'target', 'targetSize'].includes(mode)) throw new Error('Unsupported export mode.');
  const target = mode !== 'crf';
  const info = options.encoderId ? (await mediaFacts(inputPath, signal)).info : target || (copyAudio && format === 'mp4') ? await ffprobeJSON(inputPath, signal) : null;
  const sourceDuration = Number(info?.format?.duration);
  if (options.encoderId && (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || !Number.isFinite(Number(startTime)) || Number(startTime) < 0 || Number(startTime) + duration > sourceDuration + 0.002)) throw new Error('Clip bounds are outside the source duration.');
  const audio = info?.streams?.find(stream => stream.codec_type === 'audio');
  if (copyAudio && format === 'mp4' && audio && !['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(audio.codec_name)) {
    throw new Error('This audio codec cannot be copied into MP4 by ClipForge. Disable Copy Audio Stream or choose MKV.');
  }
  await requireEncoder(encoder.id, target ? 'target' : 'crf', signal);
  const budget = target ? targetBudget(settings, info) : null;
  checkCancelled(signal);
  const trim = ['-i', inputPath, '-map', '0:v:0'];
  if (Number(startTime) > 0) trim.push('-ss', String(startTime));
  trim.push('-t', String(duration));
  const legacyPreset = !options.encoderId && encoder.family === 'nvenc'
    ? { ultrafast: 'p1', superfast: 'p2', veryfast: 'p3', faster: 'p4', fast: 'p4', medium: 'p5', slow: 'p6', slower: 'p7', veryslow: 'p7' }[options.preset] : undefined;
  const video = encoderArgs(encoder, { ...options, preset: legacyPreset || options.preset }, budget?.videoBitrate);
  if (encoder.codec === 'hevc' && format === 'mp4') video.push('-tag:v', 'hvc1');
  const audioArgs = copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', String(AAC_BITRATE)];
  const output = ['-map', '0:a:0?', ...audioArgs, '-f', format === 'mkv' ? 'matroska' : format, '-n', outputPath];
  const twoPass = target && encoder.twoPass;
  const progressState = {};
  let passDirectory;
  try {
    let passArgs = [];
    if (twoPass) {
      passDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-pass-'));
      passArgs = ['-passlogfile', path.join(passDirectory, 'video')];
      await runFFmpeg([...trim, ...video, ...passArgs, '-pass', '1', '-an', '-f', 'null', '-'],
        { duration, onProgress, pass: 1, passes: 2, progressState, signal });
    }
    // Repeat immediately before output creation, including after the analysis pass.
    await assertOutputAvailable(inputPath, outputPath);
    await withOutput(outputPath, signal, temporaryPath => runFFmpeg(
      [...trim, ...video, ...passArgs, ...(twoPass ? ['-pass', '2'] : []), ...output.slice(0, -1), temporaryPath],
      { duration, onProgress, pass: twoPass ? 2 : 1, passes: twoPass ? 2 : 1, progressState, signal }));
  } finally {
    if (passDirectory) await fs.rm(passDirectory, { recursive: true, force: true });
  }
  return { outputPath };
}
