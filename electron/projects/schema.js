export const CURRENT_VERSION = '1.0.0';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Validate structure, not media bounds: the renderer reconciles those against a fresh probe.
export function validateProject(data) {
  if (!object(data)) throw new Error('Invalid project: expected a JSON object.');
  if (data.version !== undefined) {
    if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) {
      throw new Error('Invalid project version.');
    }
    if (Number(data.version.split('.')[0]) > 1) throw new Error(`Unsupported project version ${data.version}. This file has not been changed.`);
  }
  for (const field of ['sourceVideo', 'selection', 'encoderPrefs']) {
    if (data[field] !== undefined && !object(data[field])) throw new Error(`Invalid project ${field}.`);
  }
  if (data.sourceVideo && typeof data.sourceVideo.path !== 'string') throw new Error('Invalid project source path.');
  if (data.segments !== undefined && !Array.isArray(data.segments)) throw new Error('Invalid project segments.');
  for (const field of ['createdAt', 'lastModified']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`Invalid project ${field}.`);
  }
  return data;
}

export function migrateProject(data) {
  validateProject(data);
  const migrated = { ...data, version: data.version || CURRENT_VERSION };
  // Older ClipForge sidecars had only a selection. Keep its bounds for P0 reconciliation.
  if (data.segments === undefined && data.selection) {
    migrated.segments = [{ id: 'segment-1', name: 'Main segment', start: data.selection.inTime, end: data.selection.outTime }];
    migrated.activeSegmentId = 'segment-1';
  }
  return migrated;
}

export function withProjectMetadata(data) {
  validateProject(data);
  return { ...data, version: data.version || CURRENT_VERSION,
    createdAt: data.createdAt || new Date().toISOString(), lastModified: new Date().toISOString() };
}
