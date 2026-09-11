import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { cleanSafeFile } from '../paths.js';
import { ffprobeJSON } from './probe.js';
import { assertOutputAvailable, runFFmpeg } from './ffmpegRunner.js';
import { AAC_BITRATE, targetBudget } from './budget.js';
import { getEncoderCapabilities } from './capabilities.js';

function normalized(options) {
  return { ...options,
    duration: Number(options.duration) > 0 ? Number(options.duration) : Number(options.endTime) - Number(options.startTime),
    useGPU: Boolean(options.useGPU ?? options.useGpu),
  };
}

export async function getExportEstimate(options) {
  return targetBudget(normalized(options), await ffprobeJSON(cleanSafeFile(options.inputPath)));
}

export async function exportVideo(options, onProgress) {
  const settings = normalized(options);
  const { duration, startTime, mode, copyAudio, useGPU } = settings;
  const inputPath = cleanSafeFile(options.inputPath);
  const outputPath = options.outputPath ? path.normalize(options.outputPath) : '';
  const format = String(options.containerFormat || options.format || path.extname(outputPath).slice(1)).toLowerCase();
  if (!['mp4', 'mkv', 'matroska'].includes(format)) throw new Error('Export supports MP4 or MKV with H.264 only. Choose MP4 or MKV.');
  await assertOutputAvailable(inputPath, outputPath);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid export duration (segment length must be > 0)');
  if (!['crf', 'target', 'targetSize'].includes(mode)) throw new Error('Unsupported export mode.');
  const target = mode !== 'crf';
  const info = target || (copyAudio && format === 'mp4') ? await ffprobeJSON(inputPath) : null;
  const audio = info?.streams?.find(stream => stream.codec_type === 'audio');
  if (copyAudio && format === 'mp4' && audio && !['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(audio.codec_name)) {
    throw new Error('This audio codec cannot be copied into MP4 by ClipForge. Disable Copy Audio Stream or choose MKV.');
  }
  if (useGPU) {
    const capabilities = await getEncoderCapabilities();
    if (!capabilities.nvenc) throw new Error(`${capabilities.reason} Use CPU encoding instead.`);
  }
  const budget = target ? targetBudget(settings, info) : null;
  const preset = String(options.preset || 'medium').toLowerCase();
  const nvencPreset = { ultrafast: 'p1', superfast: 'p2', veryfast: 'p3', faster: 'p4', fast: 'p4', medium: 'p5', slow: 'p6', slower: 'p7', veryslow: 'p7' }[preset] || 'p5';
  const trim = ['-i', inputPath, '-map', '0:v:0'];
  if (Number(startTime) > 0) trim.push('-ss', String(startTime));
  trim.push('-t', String(duration));
  const video = ['-c:v', useGPU ? 'h264_nvenc' : 'libx264', '-preset', useGPU ? nvencPreset : preset];
  if (target) {
    video.push('-b:v', String(budget.videoBitrate));
    if (useGPU) video.push('-rc', 'vbr', '-multipass', 'fullres', '-maxrate', String(budget.videoBitrate), '-bufsize', String(budget.videoBitrate * 2));
  } else {
    const quality = Number.isFinite(Number(options.crfValue)) ? Math.max(0, Math.min(51, Number(options.crfValue))) : 23;
    if (useGPU) video.push('-rc', 'vbr', '-cq', String(quality));
    else video.push('-crf', String(quality));
  }
  const audioArgs = copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', String(AAC_BITRATE)];
  const output = ['-map', '0:a:0?', ...audioArgs, '-f', format === 'mkv' ? 'matroska' : format, '-n', outputPath];
  const twoPass = target && !useGPU;
  const progressState = {};
  let passDirectory;
  try {
    let passArgs = [];
    if (twoPass) {
      passDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-pass-'));
      passArgs = ['-passlogfile', path.join(passDirectory, 'video')];
      await runFFmpeg([...trim, ...video, ...passArgs, '-pass', '1', '-an', '-f', 'null', '-'],
        { duration, onProgress, pass: 1, passes: 2, progressState });
    }
    // Repeat immediately before output creation, including after the analysis pass.
    await assertOutputAvailable(inputPath, outputPath);
    await runFFmpeg([...trim, ...video, ...passArgs, ...(twoPass ? ['-pass', '2'] : []), ...output],
      { duration, onProgress, pass: twoPass ? 2 : 1, passes: twoPass ? 2 : 1, progressState });
  } finally {
    if (passDirectory) await fs.rm(passDirectory, { recursive: true, force: true });
  }
  return { outputPath };
}
