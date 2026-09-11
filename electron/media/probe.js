import { execFile } from 'node:child_process';
import { getFFmpegPath } from './binaries.js';
import { cleanSafeFile } from '../paths.js';

const parseFrac = (s) => {
  if (!s || s === '0/0') return undefined;
  const [n,d] = s.split('/').map(Number);
  return d ? n/d : undefined;
};

export const ffprobeJSON = (filePath) => new Promise((resolve, reject) => {
  const ffprobe = getFFmpegPath().ffprobe;
  execFile(ffprobe, ['-v','quiet','-print_format','json','-show_format','-show_streams', filePath],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    }
  );
});

export async function getVideoInfo(p) {
  const filePath = cleanSafeFile(p);
  try {
    const raw = await ffprobeJSON(filePath);
    const fmt = raw?.format ?? {};
    const streams = raw?.streams ?? [];
    const v = streams.find(s => s.codec_type === 'video');
    const a = streams.find(s => s.codec_type === 'audio');

    const fps =
      parseFrac(v?.avg_frame_rate) ??
      parseFrac(v?.r_frame_rate) ??
      (Number.isFinite(v?.fps) ? Number(v?.fps) : undefined);

    const duration = Number(fmt.duration) || 0;
    const size = Number(fmt.size) || 0;
    const bitrate =
      Number(fmt.bit_rate) ||
      Number(v?.bit_rate) ||
      (duration > 0 && size > 0 ? Math.round((size * 8) / duration) : 0);

    return {
      duration,
      size,
      bitrate,
      video: v ? {
        codec: v.codec_name || v.codec_tag_string || 'unknown',
        width: Number(v.width) || 0,
        height: Number(v.height) || 0,
        fps: fps || 0,
        pixelFormat: v.pix_fmt || 'unknown',
      } : null,
      audio: a ? {
        codec: a.codec_name || a.codec_tag_string || 'unknown',
        channels: Number(a.channels) || 0,
        sampleRate: Number(a.sample_rate) || 0,
        bitrate: Number(a.bit_rate) || 0,
      } : null,
      path: filePath,
    };
  } catch (err) {
    console.error('ffprobe failed:', err);
    throw err;
  }
}
