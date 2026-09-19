import { cleanSafeFile } from '../paths.js';
import { assertOutputAvailable, runFFmpeg } from './ffmpegRunner.js';
import { withOutput } from './output.js';
import { mediaFacts, getKeyframes, alignRange } from './keyframes.js';
import { checkCancelled } from './jobs.js';

export function copyStreams(info, format) {
  const mp4 = format === 'mp4';
  if (!mp4 && format !== 'mkv' && format !== 'matroska') throw new Error('Choose MP4 or MKV.');
  const video = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const videoCodecs = mp4 ? ['h264', 'hevc', 'av1', 'mpeg4'] : ['h264', 'hevc', 'av1', 'vp8', 'vp9', 'mpeg4', 'mpeg2video', 'ffv1'];
  if (!video || !videoCodecs.includes(video.codec_name)) throw new Error('This video codec is not supported for fast export in this container. Choose Exact export.');
  if (video !== info.streams.find(stream => stream.codec_type === 'video')) throw new Error('Fast export of media with a cover-art video track requires Exact export.');
  const audioCodecs = mp4 ? ['aac', 'mp3', 'ac3', 'eac3', 'alac'] : ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'flac', 'opus', 'vorbis', 'dts', 'truehd', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le'];
  const subtitleCodecs = mp4 ? ['mov_text'] : ['subrip', 'ass', 'ssa', 'webvtt', 'hdmv_pgs_subtitle', 'dvd_subtitle'];
  const streams = [video], omitted = [];
  for (const stream of info.streams) {
    if (stream.codec_type === 'audio') {
      if (!audioCodecs.includes(stream.codec_name)) throw new Error(`Cannot copy ${stream.codec_name} audio into ${format.toUpperCase()}. Choose MKV or Exact with AAC audio.`);
      streams.push(stream);
    } else if (stream.codec_type === 'subtitle') {
      if (subtitleCodecs.includes(stream.codec_name)) streams.push(stream);
      else omitted.push(stream.codec_name + ' subtitles');
    } else if (stream.codec_type === 'attachment' && !mp4) streams.push(stream);
  }
  return { indices: streams.map(stream => stream.index), omitted };
}

export async function trimPlan(options, signal) {
  const { info } = await mediaFacts(options.inputPath, signal);
  const duration = Number(info.format?.duration), start = Number(options.startTime), end = start + Number(options.duration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.002) throw new Error('Clip bounds are outside the source duration.');
  const streams = copyStreams(info, options.containerFormat);
  const first = await getKeyframes(options.inputPath, start, signal);
  const last = end >= duration - 0.002 ? { times: [] } : await getKeyframes(options.inputPath, end, signal);
  checkCancelled(signal);
  return { ...alignRange(start, end, duration, first.times, last.times), ...streams };
}

export async function fastTrim(options, onProgress, signal) {
  checkCancelled(signal);
  await assertOutputAvailable(options.inputPath, options.outputPath);
  const plan = await trimPlan(options, signal);
  await assertOutputAvailable(options.inputPath, options.outputPath);
  await withOutput(options.outputPath, signal, temporary => runFFmpeg([
    '-ss', String(plan.startTime), '-i', cleanSafeFile(options.inputPath), '-t', String(plan.duration),
    ...plan.indices.flatMap(index => ['-map', `0:${index}`]), '-c', 'copy', '-map_chapters', '-1', '-avoid_negative_ts', 'make_zero',
    '-f', options.containerFormat === 'mkv' ? 'matroska' : options.containerFormat, '-n', temporary,
  ], { duration: plan.duration, onProgress, signal }));
  return { outputPath: options.outputPath };
}
