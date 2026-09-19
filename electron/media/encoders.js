const softwarePresets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const make = (id, codec, label, family, quality, presets, defaultPreset, twoPass = false) =>
  ({ id, codec, label, family, hardware: !['x264', 'x265', 'svt'].includes(family), quality, presets, defaultPreset, twoPass });
export const ENCODERS = [
  make('libx264', 'h264', 'CPU / x264', 'x264', { label: 'CRF', min: 0, max: 51, default: 23 }, softwarePresets, 'medium', true),
  make('libx265', 'hevc', 'CPU / x265', 'x265', { label: 'CRF', min: 0, max: 51, default: 28 }, softwarePresets, 'medium'),
  make('libsvtav1', 'av1', 'CPU / SVT-AV1', 'svt', { label: 'CRF', min: 0, max: 63, default: 32 }, ['4', '6', '8', '10', '12'], '8'),
  ...['h264', 'hevc', 'av1'].flatMap(codec => [
    make(`${codec}_nvenc`, codec, 'NVIDIA / NVENC', 'nvenc', { label: 'CQ', min: 1, max: 51, default: 23 }, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], 'p5'),
    make(`${codec}_qsv`, codec, 'Intel / QSV', 'qsv', { label: 'ICQ', min: 1, max: 51, default: 23 }, ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'], 'medium'),
    make(`${codec}_amf`, codec, 'AMD / AMF', 'amf', { label: 'QP', min: 0, max: codec === 'av1' ? 255 : 51, default: codec === 'av1' ? 100 : 23 }, ['speed', 'balanced', 'quality'], 'balanced'),
  ]),
];

export function encoderFor(options) {
  const id = options.encoderId || ((options.useGPU ?? options.useGpu) ? 'h264_nvenc' : 'libx264');
  const encoder = ENCODERS.find(item => item.id === id);
  if (!encoder) throw new Error('Unknown encoder. Choose an available encoder.');
  return encoder;
}

export function encoderArgs(encoder, { mode = 'crf', crfValue, preset }, bitrate) {
  const target = mode !== 'crf';
  const q = Number(crfValue ?? encoder.quality.default);
  if (!target && (!Number.isFinite(q) || q < encoder.quality.min || q > encoder.quality.max)) throw new Error(`Invalid ${encoder.quality.label} value for ${encoder.label}.`);
  const selectedPreset = encoder.presets.includes(preset) ? preset : encoder.defaultPreset;
  const args = ['-c:v', encoder.id, encoder.family === 'amf' ? '-quality' : '-preset', selectedPreset, '-pix_fmt', ['qsv', 'amf'].includes(encoder.family) ? 'nv12' : 'yuv420p'];
  if (target) {
    if (!Number.isFinite(bitrate) || bitrate <= 0) throw new Error('Invalid video bitrate budget.');
    args.push('-b:v', String(bitrate));
    if (encoder.hardware) args.push('-maxrate', String(bitrate), '-bufsize', String(bitrate * 2));
    if (encoder.family === 'nvenc') args.push('-rc', 'vbr', '-multipass', 'fullres');
    if (encoder.family === 'amf') args.push('-rc', 'vbr_peak');
  } else if (encoder.family === 'nvenc') args.push('-rc', 'vbr', '-cq', String(q), '-b:v', '0');
  else if (encoder.family === 'qsv') args.push('-global_quality', String(q));
  else if (encoder.family === 'amf') args.push('-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q), '-qp_b', String(q));
  else args.push('-crf', String(q));
  return args;
}
