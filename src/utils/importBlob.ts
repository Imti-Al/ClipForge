import type { ElectronAPI } from '../types/electron';
import { unwrapIpc } from './ipc';

export async function importBlobFile(api: ElectronAPI, file: File, isCurrent: () => boolean) {
  const id = crypto.randomUUID();
  let completed = false;
  try {
    const { chunkBytes } = unwrapIpc(await api.beginImport(id, file.name, file.size));
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > 1024 * 1024) throw new Error('Invalid import transfer size.');
    for (let offset = 0; offset < file.size; offset += chunkBytes) {
      if (!isCurrent()) return;
      const bytes = await file.slice(offset, Math.min(file.size, offset + chunkBytes)).arrayBuffer();
      if (!isCurrent()) return;
      unwrapIpc(await api.writeImportChunk(id, offset, bytes));
    }
    if (!isCurrent()) return;
    const result = unwrapIpc(await api.finishImport(id));
    if (!isCurrent()) return;
    completed = true;
    return { id, tempPath: result.tempPath };
  } finally {
    if (!completed) unwrapIpc(await api.abortImport(id));
  }
}
