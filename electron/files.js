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
          await fs.unlink(filePath);
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


export async function importBlob(bytes, name) {
    await fs.mkdir(TEMP_IMPORT_DIR, { recursive: true });
    const originalName = String(name || 'drop');
    const ext = path.extname(originalName) || '';
    const base = path.basename(originalName, ext) || 'drop';
    const safeBase = base
      .replace(/[^\w.\-]+/g, '_')
      .replace(/_+/g, '_');
    const safeExt = ext.replace(/[^\w.]+/g, '');
    const filePath = path.join(TEMP_IMPORT_DIR, `${Date.now()}-${safeBase}${safeExt}`);
    // bytes may be a Uint8Array or ArrayBuffer – handle both
    const buf = bytes?.buffer instanceof ArrayBuffer
    ? Buffer.from(bytes.buffer)
    : Buffer.from(bytes);

    await fs.writeFile(filePath, buf);
    return { tempPath: filePath, isTemp: true };
}

export async function moveFile(src, dst) {
    try { await fs.rename(src, dst); }
    catch (e) {
      if (e && e.code === 'EXDEV') { await fs.copyFile(src, dst); await fs.unlink(src); }
      else throw e;
    }
    return { dst };
}
