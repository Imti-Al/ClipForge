import path from 'node:path';

export const norm = (p) => path.normalize(p).replace(/\\/g, '/').toLowerCase();
export const cleanSafeFile = (p) => (p?.startsWith('safe-file:') ? p.replace('safe-file:', '') : p);
