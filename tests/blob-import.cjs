const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function utility() {
  const exports = {}, ipc = {};
  const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compile('src/utils/ipc.ts'), { exports: ipc });
  vm.runInNewContext(compile('src/utils/importBlob.ts'), { exports, require: () => ipc, crypto: require('node:crypto').webcrypto });
  return exports.importBlobFile;
}
const ok = data => ({ success: true, data });

test('blob imports read only bounded slices and wait for each IPC acknowledgement', async () => {
  const transfer = utility();
  const slices = [], offsets = []; let writing = false, peak = 0, active = 0;
  const file = { name: 'large.mp4', size: 3 * 1024 * 1024 + 9,
    arrayBuffer() { throw new Error('Whole-file buffering is forbidden'); },
    slice(start, end) {
      assert.equal(writing, false); slices.push([start, end]);
      return { arrayBuffer: async () => new ArrayBuffer(end - start) };
    },
  };
  const result = await transfer({
    beginImport: async () => ok({ chunkBytes: 1024 * 1024 }),
    writeImportChunk: async (_id, offset, bytes) => {
      writing = true; offsets.push(offset); active += bytes.byteLength; peak = Math.max(peak, active);
      await new Promise(resolve => setImmediate(resolve)); active -= bytes.byteLength; writing = false; return ok();
    },
    finishImport: async () => ok({ tempPath: 'temp.mp4' }),
    abortImport: async () => { throw new Error('Completed import must be retained'); },
  }, file, () => true);
  assert.equal(result.tempPath, 'temp.mp4'); assert.equal(slices.length, 4);
  assert.equal(peak, 1024 * 1024); assert.deepEqual(offsets, slices.map(slice => slice[0]));
  assert.equal(slices.at(-1)[1], file.size);
});

test('superseded and failed transfers abort and never finish, including supersession during finish', async () => {
  for (const stage of ['read', 'write', 'finish', 'failure']) {
    let current = true, aborted = 0, finishes = 0;
    const operation = utility()({ beginImport: async () => ok({ chunkBytes: 4 }),
      writeImportChunk: async () => {
        if (stage === 'failure') return { success: false, error: 'Disk full', code: 'IO' };
        if (stage === 'write') current = false; return ok();
      },
      finishImport: async () => { finishes++; current = false; return ok({ tempPath: 'temp.mp4' }); },
      abortImport: async () => { aborted++; return ok(true); },
    }, { name: 'blob.mp4', size: 4, slice: () => ({ arrayBuffer: async () => {
      if (stage === 'read') current = false; return new ArrayBuffer(4);
    } }) }, () => current);
    if (stage === 'failure') await assert.rejects(operation, /Disk full/); else assert.equal(await operation, undefined);
    assert.equal(aborted, 1); assert.equal(finishes, stage === 'finish' ? 1 : 0);
  }
});
