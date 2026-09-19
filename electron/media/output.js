import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { checkCancelled, beginPublication } from './jobs.js';

// Encode beside the destination, then publish atomically without replacing any file.
export async function withOutput(outputPath, signal, operation) {
  checkCancelled(signal);
  const directory = await fs.mkdtemp(path.join(path.dirname(outputPath), '.clipforge-output-'));
  const temporaryPath = path.join(directory, `output${path.extname(outputPath)}`);
  try {
    checkCancelled(signal);
    await operation(temporaryPath);
    beginPublication(signal);
    try {
      try {
        await fs.link(temporaryPath, outputPath);
      } catch (error) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
        // FAT/exFAT and some network volumes cannot hard-link. COPYFILE_EXCL still forbids replacement.
        await fs.copyFile(temporaryPath, outputPath, constants.COPYFILE_EXCL);
      }
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw Object.assign(new Error('The output already exists. Choose a different output filename.'), { code: 'OUTPUT_EXISTS' });
      }
      throw error;
    }
    // Publication is the commit point; cancellation after it must not remove a completed output.
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
