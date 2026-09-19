import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getFFmpegPath } from './binaries.js';
import { norm, cleanSafeFile } from '../paths.js';
import { cancelled, checkCancelled } from './jobs.js';

export async function assertOutputAvailable(inputPath, outputPath) {
  if (!inputPath || !outputPath) throw new Error('Input and output paths are required.');
  if (norm(path.resolve(cleanSafeFile(inputPath))) === norm(path.resolve(outputPath))) {
    throw new Error('OUTPUT_EXISTS: The output cannot replace the source video.');
  }
  try {
    await fs.lstat(outputPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`OUTPUT_EXISTS: ${outputPath} already exists. Choose a different output filename.`);
}

export function runFFmpeg(args, { duration, onProgress, remux = false, inputPath, pass = 1, passes = 1, progressState = {}, signal }) {
  return new Promise((resolve, reject) => {
    checkCancelled(signal);
    const executable = getFFmpegPath().ffmpeg;
    console.log(remux ? 'FFmpeg remux command:' : 'FFmpeg command:', executable, args.join(' '));
    const child = spawn(executable, ['-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true });
    let killTimer;
    const abort = () => {
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref?.();
      child.kill();
    };
    const cleanup = () => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let error = '';
    let buffer = '', record = {}, currentTime = 0, smoothSpeed = progressState.speed || 0, lastProgress = 0;
    const report = () => {
      if (signal?.aborted) return;
      const time = Number(record.out_time_us ?? record.out_time_ms) / 1000000;
      if (Number.isFinite(time)) currentTime = Math.max(currentTime, Math.min(duration || Infinity, Math.max(0, time)));
      const speed = Number(String(record.speed || '').replace('x', ''));
      if (Number.isFinite(speed) && speed > 0) smoothSpeed = smoothSpeed ? smoothSpeed * 0.8 + speed * 0.2 : speed;
      progressState.speed = smoothSpeed;
      const completed = (pass - 1) * duration + currentTime;
      const progress = duration > 0 ? Math.min(99, Math.floor(completed / (duration * passes) * 100)) : 0;
      lastProgress = Math.max(lastProgress, progress);
      onProgress?.({ ...(remux ? { inputPath } : {}), currentTime, speed: smoothSpeed, progress: remux && !duration ? undefined : lastProgress,
        etaSeconds: smoothSpeed > 0 && duration > 0 ? Math.max(0, duration * passes - completed) / smoothSpeed : undefined,
        pass, passes });
      record = {};
    };
    child.stdout.on('data', data => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const separator = line.indexOf('=');
        if (separator > 0) record[line.slice(0, separator)] = line.slice(separator + 1);
        if (line.startsWith('progress=')) report();
      }
      buffer = buffer.slice(-8192);
    });
    child.stderr.on('data', data => {
      error = (error + data.toString()).slice(-65536);
    });
    child.on('close', code => {
      cleanup();
      if (signal?.aborted) reject(cancelled());
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg${remux ? ' remux' : ''} failed with code ${code}: ${error}`));
    });
    child.on('error', err => {
      cleanup();
      reject(signal?.aborted ? cancelled() : new Error(`Failed to start FFmpeg${remux ? ' for remux' : ''}: ${err.message}`));
    });
  });
}
