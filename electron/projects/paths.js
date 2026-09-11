import path from 'node:path';
import { cleanSafeFile } from '../paths.js';

export const PROJECT_EXT = 'clipforge';
export function sidecarPathForSource(source) {
  const parsed = path.parse(cleanSafeFile(source));
  return path.join(parsed.dir, `${parsed.name}-proj.${PROJECT_EXT}`);
}

export function validateProjectPath(projectPath) {
  if (!projectPath) throw new Error('Missing project path');
  if (!['.clipforge', '.llc'].includes(path.extname(projectPath).toLowerCase())) {
    throw new Error('Choose a .clipforge or .llc project file.');
  }
}
