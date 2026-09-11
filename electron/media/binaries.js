import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';

const electronDir = path.dirname(fileURLToPath(new URL('../main.js', import.meta.url)));

export function getFFmpegPath() {
  const platform = os.platform();
  
  // Try multiple possible locations for FFmpeg binaries
  const platformDir = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  const extension = platform === 'win32' ? '.exe' : '';
  
  // Possible locations to check for FFmpeg binaries
  const possibleDirs = app.isPackaged ? [
    path.join(process.resourcesPath, 'ffmpeg', platformDir),
  ] : [
    // Current directory structure
    path.join(electronDir, 'ffmpeg', platformDir),
    // Project root ffmpeg directory
    path.join(electronDir, '..', 'ffmpeg', platformDir),
    // If running from dist
    path.join(process.cwd(), 'ffmpeg', platformDir),
    // If binaries are in the same directory as the executable
    path.join(electronDir, platformDir),
  ];
  
  // Function to check if a binary exists
  const findBinary = (name) => {
    const binaryName = `${name}${extension}`;
    
    // First try the possible directories
    for (const dir of possibleDirs) {
      const fullPath = path.join(dir, binaryName);
      if (fsSync.existsSync(fullPath)) {
        console.log(`Found ${name} at: ${fullPath}`);
        return fullPath;
      }
    }
    
    throw new Error(`Missing bundled ${binaryName}. Expected in: ${possibleDirs.join(', ')}`);
  };
  
  return {
    ffmpeg: findBinary('ffmpeg'),
    ffprobe: findBinary('ffprobe')
  };
}
