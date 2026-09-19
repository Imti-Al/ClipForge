import { execFile } from './probeProcesses.js';
import { getFFmpegPath } from './binaries.js';
import { ENCODERS, encoderArgs } from './encoders.js';
import { cancelled, checkCancelled } from './jobs.js';

const cache = new Map();
function probe(encoder, mode) {
  return new Promise(resolve => {
    try {
      const args = encoderArgs(encoder, { mode, crfValue: encoder.quality.default, preset: encoder.defaultPreset }, 1000000);
      execFile(getFFmpegPath().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=640x360:rate=30',
        '-frames:v', '3', ...args, '-f', 'null', '-'],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536 }, (error, _stdout, stderr) => {
        resolve({ available: !error, reason: error ? String(stderr || error.message).slice(-1200) : '' });
      });
    } catch (error) { resolve({ available: false, reason: error.message }); }
  });
}

export function getEncoderCapability(id) {
  const encoder = ENCODERS.find(item => item.id === id);
  if (!encoder) return Promise.reject(new Error('Unknown encoder.'));
  if (!cache.has(id)) cache.set(id, (async () => {
    const quality = await probe(encoder, 'crf');
    const target = await probe(encoder, 'target');
    return { ...encoder, available: quality.available || target.available,
      modes: { crf: quality.available, target: target.available },
      reason: [quality.available ? '' : `Quality: ${quality.reason}`, target.available ? '' : `Target size: ${target.reason}`].filter(Boolean).join('\n') };
  })());
  return cache.get(id);
}

export async function getEncoderCapabilities(codec = 'h264') {
  if (!['h264', 'hevc', 'av1'].includes(codec)) throw new Error('Unsupported video codec.');
  const definitions = ENCODERS.filter(encoder => encoder.codec === codec);
  const encoders = [];
  // Bound simultaneous device initialization instead of opening every adapter at once.
  for (let index = 0; index < definitions.length; index += 2) {
    encoders.push(...await Promise.all(definitions.slice(index, index + 2).map(encoder => getEncoderCapability(encoder.id))));
  }
  const nvenc = encoders.find(encoder => encoder.family === 'nvenc');
  return { encoders, nvenc: !!nvenc?.modes.crf, reason: nvenc?.reason || '' };
}

export async function requireEncoder(id, mode, signal) {
  checkCancelled(signal);
  let abort;
  try {
    const capability = await Promise.race([getEncoderCapability(id), new Promise((_, reject) => {
      abort = () => reject(cancelled());
      signal?.addEventListener('abort', abort, { once: true });
    })]);
    checkCancelled(signal);
    if (!capability.modes[mode]) throw new Error(`${capability.label} is unavailable for this mode. ${capability.reason}`);
    return capability;
  } finally { signal?.removeEventListener('abort', abort); }
}
