import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getFFmpegPath } from './binaries.js';
import { norm, cleanSafeFile } from '../paths.js';

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

export function runFFmpeg(args, { duration, onProgress, remux = false, inputPath }) {
  return new Promise((resolve, reject) => {
    const executable = getFFmpegPath().ffmpeg;
    console.log(remux ? 'FFmpeg remux command:' : 'FFmpeg command:', executable, args.join(' '));
    const child = spawn(executable, args);
    let error = '';
    child.stderr.on('data', data => {
      const output = data.toString();
      error += output;
      const match = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (!match) return;
      const currentTime = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      const speed = output.match(/speed=\s*(\d+\.?\d*)x/);
      const progress = duration > 0
        ? (remux ? Math.min(99, Math.round(currentTime / duration * 100)) : Math.round(Math.min(100, currentTime / duration * 100)))
        : (remux ? undefined : 0);
      onProgress?.({ ...(remux ? { inputPath } : {}), currentTime, speed: speed ? Number(speed[1]) : 1, progress });
    });
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg${remux ? ' remux' : ''} failed with code ${code}: ${error}`)));
    child.on('error', err => reject(new Error(`Failed to start FFmpeg${remux ? ' for remux' : ''}: ${err.message}`)));
  });
}
