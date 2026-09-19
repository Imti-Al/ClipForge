import fs from 'node:fs/promises';
import path from 'node:path';
import { norm, cleanSafeFile } from '../paths.js';
import { sidecarPathForSource, validateProjectPath } from './paths.js';
import { migrateProject, withProjectMetadata } from './schema.js';

export function createProjectStore({ isTempImportPath }) {
  const writes = new Map();
  const deleteOnExit = new Set();

  function write(projectPath, data) {
    const key = norm(path.resolve(projectPath));
    const previous = writes.get(key) || Promise.resolve();
    const serialized = JSON.stringify(withProjectMetadata(data), null, 2);
    const pending = previous.catch(() => {}).then(async () => {
      const temporary = projectPath + '.tmp';
      await fs.writeFile(temporary, serialized, 'utf8');
      await fs.rename(temporary, projectPath);
    });
    writes.set(key, pending);
    const release = () => { if (writes.get(key) === pending) writes.delete(key); };
    pending.then(release, release);
    return pending;
  }

  async function saveFile(projectPath, data) {
    validateProjectPath(projectPath);
    if (data?.sourceVideo?.path && norm(path.resolve(projectPath)) === norm(path.resolve(cleanSafeFile(data.sourceVideo.path)))) {
      throw new Error('A project file cannot overwrite its source video.');
    }
    await write(projectPath, data);
    return projectPath;
  }

  return {
    saveFile,
    async saveSidecar(source, data) {
      if (!source) throw new Error('Missing source path');
      if (isTempImportPath(source)) throw new Error('Cannot save sidecar next to temporary file. Use "Save Video & Project…" first.');
      return saveFile(sidecarPathForSource(source), data);
    },
    async read(projectPath) {
      return migrateProject(JSON.parse(await fs.readFile(projectPath, 'utf8')));
    },
    async exists(projectPath) {
      try { await fs.access(projectPath); return true; } catch { return false; }
    },
    setDeleteOnExit(projectPath, enabled) {
      if (!projectPath) return false;
      if (enabled) deleteOnExit.add(projectPath); else deleteOnExit.delete(projectPath);
      return true;
    },
    async cleanupOnExit() {
      await Promise.allSettled([...writes.values()]);
      for (const projectPath of deleteOnExit) { try { await fs.unlink(projectPath); } catch {} }
    },
  };
}
