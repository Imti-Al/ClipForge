import path from 'node:path';
import { assertOutputAvailable } from './ffmpegRunner.js';
import { mediaFacts } from './keyframes.js';
import { trimPlan } from './trim.js';

export function clipOutputPath(output, clip, index, count, format) {
  if (count === 1) return output;
  const parsed = path.parse(output);
  const name = String(clip.name || 'clip').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 60) || 'clip';
  return path.join(parsed.dir, `${parsed.name}-${String(index + 1).padStart(3, '0')}-${name}.${format}`);
}

export async function getExportPlan({ inputPath, outputPath, containerFormat, clips, method }) {
  if (!['mp4', 'mkv'].includes(containerFormat)) throw new Error('Choose MP4 or MKV.');
  if (!outputPath || path.extname(outputPath).toLowerCase() !== '.' + containerFormat) throw new Error('Destination extension must match the selected container.');
  if (!Array.isArray(clips) || !clips.length || clips.length > 1000) throw new Error('Choose between 1 and 1000 clips.');
  const { info } = await mediaFacts(inputPath);
  const sourceDuration = Number(info.format?.duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Source duration is unavailable.');
  const plan = [];
  for (const [index, clip] of clips.entries()) {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start || clip.end > sourceDuration + 0.002) throw new Error(`Clip ${index + 1} has invalid bounds.`);
    const destination = clipOutputPath(outputPath, clip, index, clips.length, containerFormat);
    await assertOutputAvailable(inputPath, destination);
    const copy = method === 'copy' ? await trimPlan({ inputPath, startTime: clip.start, duration: clip.end - clip.start, containerFormat }) : null;
    plan.push({ outputPath: destination, name: clip.name || `Clip ${index + 1}`, startTime: clip.start, duration: clip.end - clip.start,
      actualStart: copy?.startTime ?? clip.start, actualEnd: copy?.endTime ?? clip.end, omitted: copy?.omitted || [] });
  }
  return plan;
}
