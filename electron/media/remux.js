import { cleanSafeFile } from '../paths.js';
import { assertOutputAvailable, runFFmpeg } from './ffmpegRunner.js';
import { withOutput } from './output.js';

export async function remuxVideo(options, onProgress, signal) {
  await assertOutputAvailable(options.inputPath, options.outputPath);
  const { inputPath, outputPath, duration } = options;
  await withOutput(outputPath, signal, temporaryPath => runFFmpeg(
    ['-i', cleanSafeFile(inputPath), '-c', 'copy', '-n', temporaryPath],
    { duration: Number(duration) > 0 ? Number(duration) : 0, onProgress, remux: true, inputPath, signal }));
  return { outputPath };
}
