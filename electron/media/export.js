import path from 'node:path';
import { cleanSafeFile } from '../paths.js';
import { ffprobeJSON } from './probe.js';
import { assertOutputAvailable, runFFmpeg } from './ffmpegRunner.js';

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function mapNvencPreset(preset) {
  const p = String(preset || 'medium').toLowerCase();
  // NVENC presets (newer ffmpeg): p1..p7 (fastest..slowest).
  // Map common x264 presets to a reasonable NVENC equivalent.
  switch (p) {
    case 'ultrafast': return 'p1';
    case 'superfast': return 'p2';
    case 'veryfast': return 'p3';
    case 'faster': return 'p4';
    case 'fast': return 'p4';
    case 'medium': return 'p5';
    case 'slow': return 'p6';
    case 'slower': return 'p7';
    case 'veryslow': return 'p7';
    default: return 'p5';
  }
}

function normalizeOutPath(p) {
  if (!p) return '';
  // Handles mixed slashes like "C:\out/foo.mp4"
  return path.normalize(String(p));
}

export async function exportVideo(options, onProgress) {
  const requestedFormat = String(options.containerFormat || options.format || path.extname(options.outputPath || '').slice(1)).toLowerCase();
  if (!['mp4', 'mkv', 'matroska'].includes(requestedFormat)) {
    throw new Error('Export supports MP4 or MKV with H.264 only. Choose MP4 or MKV.');
  }
  if (options.copyAudio && requestedFormat === 'mp4') {
    const info = await ffprobeJSON(cleanSafeFile(options.inputPath));
    const audio = info.streams?.find(stream => stream.codec_type === 'audio');
    if (audio && !['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(audio.codec_name)) {
      throw new Error('This audio codec cannot be copied into MP4 by ClipForge. Disable Copy Audio Stream or choose MKV.');
    }
  }
  await assertOutputAvailable(options.inputPath, options.outputPath);
    
    const {
      inputPath,
      outputPath,
      startTime,
      duration,
      endTime,
      containerFormat,
      format,
      mode, // 'crf' or 'target'
      crfValue,
      targetSize,
      preset,
      useGPU,
      useGpu,
      copyAudio
    } = options;
    const cleanInputPath = cleanSafeFile(inputPath);
    const exportDuration = Number(duration) > 0
      ? Number(duration)
      : (Number(endTime) > Number(startTime) ? Number(endTime) - Number(startTime) : 0);
    const cleanOutputPath = normalizeOutPath(outputPath);
    const outputFormat = (containerFormat || format || path.extname(cleanOutputPath).replace('.', '') || 'mp4').toLowerCase();
    const gpuEnabled = Boolean(useGPU ?? useGpu);

    if (!cleanInputPath) throw new Error('Missing inputPath');
    if (!cleanOutputPath) throw new Error('Missing outputPath');
    if (!Number.isFinite(exportDuration) || exportDuration <= 0) {
      throw new Error('Invalid export duration (segment length must be > 0)');
    }

    let args = ['-i', cleanInputPath, '-map', '0:v:0', '-map', '0:a:0?'];
    
    // Add start time and duration for trimming
    if (Number(startTime) > 0) {
      args.push('-ss', startTime.toString());
    }
    args.push('-t', exportDuration.toString());

    // Video encoding options
    if (mode === 'crf') {
      if (gpuEnabled) {
        // NVENC doesn't support x264-style CRF. Use VBR + CQ as a comparable quality slider.
        const cq = clamp(crfValue, 0, 51);
        args.push(
          '-c:v', 'h264_nvenc',
          '-preset', mapNvencPreset(preset),
          '-rc', 'vbr',
          '-cq', String(cq)
        );
      } else {
        args.push('-c:v', 'libx264', '-crf', String(clamp(crfValue, 0, 51)), '-preset', String(preset || 'medium').toLowerCase());
      }
    } else if (mode === 'target' || mode === 'targetSize') {
      // Calculate target bitrate based on target size and duration
      const safeTargetSize = clamp(targetSize, 1, 100000); // MB
      const targetBitrate = Math.floor((safeTargetSize * 8 * 1024) / exportDuration); // kbps
      if (gpuEnabled) {
        args.push(
          '-c:v', 'h264_nvenc',
          '-preset', mapNvencPreset(preset),
          '-b:v', `${targetBitrate}k`
        );
      } else {
        args.push('-c:v', 'libx264', '-b:v', `${targetBitrate}k`, '-preset', String(preset || 'medium').toLowerCase());
      }
    }

    // Audio options
    if (copyAudio) {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    // Output format
    args.push('-f', outputFormat === 'mkv' ? 'matroska' : outputFormat);
    
    // Refuse overwrite even if a file appears after the preflight check.
    args.push('-n');
    
    // Output path
    args.push(cleanOutputPath);

    await runFFmpeg(args, { duration: exportDuration, onProgress });
    return { outputPath: cleanOutputPath };
}
