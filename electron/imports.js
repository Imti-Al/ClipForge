import fs from 'node:fs/promises';
import path from 'node:path';
import { TEMP_IMPORT_DIR } from './files.js';

export const IMPORT_CHUNK_BYTES = 1024 * 1024;

export function createImportStore() {
  const imports = new Map();
  let closing = false;
  const find = (owner, id) => {
    const entry = imports.get(id);
    if (!entry || entry.owner !== owner || entry.aborted) throw new Error('Import is no longer available.');
    return entry;
  };
  const dispose = entry => {
    if (entry.disposing) return entry.disposing;
    entry.aborted = true;
    entry.disposing = (async () => {
      await entry.pending?.catch(() => {});
      await entry.handle?.close();
      entry.handle = null;
      if (entry.directory) await fs.rm(entry.directory, { recursive: true, force: true });
      imports.delete(entry.id);
    })().catch(error => { entry.disposing = null; throw error; });
    return entry.disposing;
  };
  return {
    async begin(owner, id, name, size) {
      if (closing || typeof id !== 'string' || !id || imports.has(id) || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid import request.');
      const entry = { id, owner, size, offset: 0, aborted: false };
      imports.set(id, entry);
      entry.pending = (async () => {
        await fs.mkdir(TEMP_IMPORT_DIR, { recursive: true });
        entry.directory = await fs.mkdtemp(path.join(TEMP_IMPORT_DIR, 'import-'));
        await fs.writeFile(path.join(entry.directory, '.owner.json'), JSON.stringify({ pid: process.pid }));
        entry.path = path.join(entry.directory, 'media-' + (path.basename(String(name || 'video')).replace(/[^\w.\-]/g, '_') || 'video'));
        entry.handle = await fs.open(entry.path, 'wx');
      })();
      try { await entry.pending; return { chunkBytes: IMPORT_CHUNK_BYTES }; }
      catch (error) { await dispose(entry); throw error; }
    },
    async chunk(owner, id, offset, bytes) {
      const entry = find(owner, id);
      if (entry.busy || !entry.handle || entry.complete) throw new Error('Import is not ready for data.');
      const data = ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes);
      if (offset !== entry.offset || !data.length || data.length > IMPORT_CHUNK_BYTES || offset + data.length > entry.size) throw new Error('Invalid import chunk.');
      entry.busy = true;
      entry.pending = (async () => {
        let written = 0;
        while (written < data.length) {
          const result = await entry.handle.write(data, written, data.length - written, offset + written);
          if (!result.bytesWritten) throw new Error('Could not write imported video.');
          written += result.bytesWritten;
        }
        entry.offset += written;
      })();
      try { await entry.pending; }
      catch (error) { entry.busy = false; await dispose(entry); throw error; }
      finally { entry.busy = false; }
    },
    async finish(owner, id) {
      const entry = find(owner, id);
      if (entry.busy || !entry.handle || entry.offset !== entry.size) throw new Error('Import is incomplete.');
      entry.busy = true;
      entry.pending = entry.handle.close().then(() => { entry.handle = null; entry.complete = true; });
      try { await entry.pending; return { tempPath: entry.path, isTemp: true }; }
      finally { entry.busy = false; }
    },
    async abort(owner, id) {
      const entry = imports.get(id);
      if (!entry || entry.owner !== owner) return false;
      await dispose(entry);
      return true;
    },
    async cleanupOwner(owner) {
      await Promise.allSettled([...imports.values()].filter(entry => entry.owner === owner).map(entry => this.abort(owner, entry.id)));
    },
    async shutdown() {
      closing = true;
      await Promise.allSettled([...imports.values()].map(entry => this.abort(entry.owner, entry.id)));
    },
  };
}
