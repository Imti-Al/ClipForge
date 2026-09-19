export const AAC_BITRATE = 128000;

export function targetBudget({ targetSize, duration, copyAudio, useGPU, approximateRateControl }, info) {
  const requestedBytes = Number(targetSize) * 1000000;
  if (!Number.isFinite(requestedBytes) || requestedBytes < 1000000 || requestedBytes > 100000000000) {
    throw new Error('Target size must be between 1 and 100000 MB (decimal).');
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid export duration.');
  const audio = info.streams?.find(stream => stream.codec_type === 'audio');
  const sourceBitrate = [audio?.bit_rate, audio?.tags?.BPS, audio?.tags?.['BPS-eng']]
    .map(Number).find(value => Number.isFinite(value) && value > 0);
  if (audio && copyAudio && !(Number.isFinite(sourceBitrate) && sourceBitrate > 0)) {
    throw new Error('Cannot budget copied audio: source audio bitrate is unknown. Disable Copy Audio Stream for target-size export.');
  }
  const audioBitrate = audio ? (copyAudio ? sourceBitrate : AAC_BITRATE) : 0;
  // Reserve mux headers/indexes, audio packet boundaries and encoder rate variation.
  const muxBytes = Math.max(16384, requestedBytes * 0.01);
  const safetyBytes = requestedBytes * (useGPU || approximateRateControl ? 0.06 : 0.02);
  const videoBitrate = Math.floor(((requestedBytes - muxBytes - safetyBytes) * 8 / duration - audioBitrate) / 1000) * 1000;
  if (videoBitrate < 16000) throw new Error('Target size is too small for this duration and audio. Increase the target size.');
  return { requestedBytes, videoBitrate, audioBitrate, muxBytes, safetyBytes,
    expectedBytes: (videoBitrate + audioBitrate) * duration / 8 + muxBytes,
    approximate: Boolean(useGPU || approximateRateControl || (audio && copyAudio)) };
}
