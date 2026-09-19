import { execFile } from './probeProcesses.js';
import { getFFmpegPath } from './binaries.js';

let capabilityPromise;
export function getEncoderCapabilities() {
  // A listed encoder can still fail without a compatible GPU/driver. Test initialization.
  capabilityPromise ??= new Promise(resolve => {
    try {
      execFile(getFFmpegPath().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=640x360:rate=30',
        '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536 }, (error, _stdout, stderr) => {
        resolve({ nvenc: !error, reason: error ? `NVENC unavailable: ${String(stderr || error.message).slice(-2000)}` : '' });
      });
    } catch (error) { resolve({ nvenc: false, reason: error.message }); }
  });
  return capabilityPromise;
}
