import { cleanSafeFile } from '../paths.js';
import { assertOutputAvailable, runFFmpeg } from './ffmpegRunner.js';

export async function remuxVideo(options, onProgress) {
  await assertOutputAvailable(options.inputPath, options.outputPath);
  const { inputPath, outputPath, duration } = options;
  const args = ['-i', cleanSafeFile(inputPath), '-c', 'copy', '-n', outputPath];
  await runFFmpeg(args, { duration: Number(duration) > 0 ? Number(duration) : 0, onProgress, remux: true, inputPath });
  return { outputPath };
}
