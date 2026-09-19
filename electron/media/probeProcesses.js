import { execFile as execute } from 'node:child_process';
import { cancelled } from './jobs.js';

const active = new Set();
let closing = false;

// Short probes retain their own timeout; shutdown still owns every child process.
export function execFile(executable, args, options, callback) {
  if (closing) { callback(cancelled(), '', ''); return; }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  active.add(controller);
  const cleanup = () => {
    active.delete(controller);
    options.signal?.removeEventListener('abort', abort);
  };
  try {
    return execute(executable, args, { ...options, signal: controller.signal }, (error, stdout, stderr) => {
      cleanup();
      callback(error, stdout, stderr);
    });
  } catch (error) { cleanup(); throw error; }
}

export function stopProbes() {
  closing = true;
  for (const controller of active) controller.abort();
}
