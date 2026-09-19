export function cancelled() {
  return Object.assign(new Error('Operation cancelled.'), { code: 'CANCELLED' });
}

export function checkCancelled(signal) {
  if (signal?.aborted) throw cancelled();
}

const states = new WeakMap();
export function beginPublication(signal) {
  checkCancelled(signal);
  const job = signal && states.get(signal);
  if (job) job.committing = true;
}

export function createJobManager() {
  const jobs = new Map();
  let closing = false;
  return {
    get size() { return jobs.size; },
    run(owner, id, operation) {
      if (closing) return Promise.reject(Object.assign(new Error('Application is closing.'), { code: 'CLOSING' }));
      if (typeof id !== 'string' || !id || jobs.has(id)) {
        return Promise.reject(Object.assign(new Error('Invalid or duplicate job identifier.'), { code: 'INVALID_JOB' }));
      }
      const controller = new AbortController();
      const job = { owner, controller, promise: null };
      states.set(controller.signal, job);
      jobs.set(id, job);
      job.promise = Promise.resolve().then(() => {
        checkCancelled(controller.signal);
        return operation(controller.signal);
      }).finally(() => { jobs.delete(id); states.delete(controller.signal); });
      return job.promise;
    },
    cancel(owner, id) {
      const job = jobs.get(id);
      if (!job || job.owner !== owner || job.committing) return false;
      job.controller.abort();
      return true;
    },
    cancelOwner(owner) {
      for (const job of jobs.values()) if (job.owner === owner && !job.committing) job.controller.abort();
      return Promise.allSettled([...jobs.values()].filter(job => job.owner === owner).map(job => job.promise));
    },
    async shutdown(timeout = 4000) {
      closing = true;
      for (const job of jobs.values()) if (!job.committing) job.controller.abort();
      let timer;
      try {
        await Promise.race([
          Promise.allSettled([...jobs.values()].map(job => job.promise)),
          new Promise(resolve => { timer = setTimeout(resolve, timeout); }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}
