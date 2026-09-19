import fs from 'node:fs/promises';
import { execFile } from './probeProcesses.js';
import { getFFmpegPath } from './binaries.js';
import { ffprobeJSON } from './probe.js';
import { cleanSafeFile } from '../paths.js';

const facts = new Map(), windows = new Map();
function remember(cache, key, value, limit) {
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}

export async function mediaFacts(source, signal) {
  const inputPath = cleanSafeFile(source);
  const stat = await fs.stat(inputPath);
  const key = `${inputPath}:${stat.size}:${stat.mtimeMs}`;
  if (facts.has(key)) return { key, inputPath, info: facts.get(key) };
  const info = await ffprobeJSON(inputPath, signal);
  remember(facts, key, info, 8);
  return { key, inputPath, info };
}

export async function getKeyframes(source, time = 0, signal) {
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid keyframe lookup time.');
  const { key, inputPath, info } = await mediaFacts(source, signal);
  const duration = Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Media duration is unavailable.');
  const bucket = Math.floor(Math.min(time, duration) / 30);
  const cacheKey = `${key}:${bucket}`;
  if (windows.has(cacheKey)) return windows.get(cacheKey);
  const start = Math.max(0, bucket * 30 - 30), end = Math.min(duration, (bucket + 1) * 30 + 30);
  const offset = Number(info.format?.start_time) || 0;
  const frames = await new Promise((resolve, reject) => {
    execFile(getFFmpegPath().ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey',
      '-read_intervals', `${Math.max(0, start + offset)}%${end + offset}`, '-show_frames',
      '-show_entries', 'frame=key_frame,best_effort_timestamp_time', '-of', 'json', inputPath],
    { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, signal }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout).frames || []); } catch (parseError) { reject(parseError); }
    });
  });
  const times = [...new Set(frames.filter(frame => frame.key_frame === 1).map(frame => Number(frame.best_effort_timestamp_time) - offset)
    .filter(value => Number.isFinite(value) && value >= -0.002 && value <= duration).map(value => Math.max(0, value)))].sort((a, b) => a - b);
  return remember(windows, cacheKey, { times, start, end, duration }, 64);
}

export function alignRange(start, end, duration, startKeys, endKeys) {
  const before = startKeys.filter(time => time <= start + 0.002).at(-1);
  const after = end >= duration - 0.002 ? duration : endKeys.find(time => time >= end - 0.002);
  if (before === undefined || after === undefined || after <= before) throw new Error('No usable keyframe boundary found nearby. Choose Exact export or adjust the clip.');
  return { startTime: before, duration: after - before, endTime: after };
}
