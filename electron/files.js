import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { norm, cleanSafeFile } from './paths.js';

export const TEMP_IMPORT_DIR = path.join(os.tmpdir(), 'ClipForgeImports');
export const isTempImportPath = source => {
  const clean = cleanSafeFile(source);
  return !!clean && norm(clean).startsWith(norm(TEMP_IMPORT_DIR) + '/');
};

// Clean up old temporary files on startup
export async function cleanupOldTempFiles() {
  try {
    await fs.access(TEMP_IMPORT_DIR);
    const files = await fs.readdir(TEMP_IMPORT_DIR);
    
    for (const file of files) {
      const filePath = path.join(TEMP_IMPORT_DIR, file);
      try {
        const stats = await fs.stat(filePath);
        const now = Date.now();
        const fileAge = now - stats.mtime.getTime();
        
        // Delete files older than 24 hours
        if (fileAge > 24 * 60 * 60 * 1000) {
          if (stats.isDirectory()) {
            if (!file.startsWith('import-')) continue;
            let owner;
            try { owner = JSON.parse(await fs.readFile(path.join(filePath, '.owner.json'), 'utf8')); }
            catch (error) { if (error.code !== 'ENOENT') continue; }
            if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
              try { process.kill(owner.pid, 0); continue; }
              catch (error) { if (error.code !== 'ESRCH') continue; }
            }
            await fs.rm(filePath, { recursive: true, force: true });
          } else await fs.unlink(filePath);
          console.log('Cleaned up old temp file:', filePath);
        }
      } catch (error) {
        console.error('Error processing temp file:', filePath, error);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be accessed - that's fine
    if (error.code !== 'ENOENT') {
      console.error('Error during temp file cleanup:', error);
    }
  }
}



export async function moveFile(src, dst) {
    try { await fs.rename(src, dst); }
    catch (e) {
      if (e && e.code === 'EXDEV') { await fs.copyFile(src, dst); await fs.unlink(src); }
      else throw e;
    }
    return { dst };
}
