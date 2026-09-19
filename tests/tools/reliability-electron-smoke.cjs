// Production renderer/preload/main and real FFmpeg. Only native picker responses are supplied.
// Run: electron tests/tools/reliability-electron-smoke.cjs
const { app, dialog } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const root = process.cwd(), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-electron-reliability-'));
  console.log('SMOKE_DIRECTORY', dir);
  app.setPath('temp', dir); process.env.TEMP = dir; process.env.TMP = dir;
  await fs.mkdir(path.join(dir, 'profile')); app.setPath('userData', path.join(dir, 'profile'));
  const input = path.join(dir, 'source.mp4'), output = path.join(dir, 'cancelled.mp4');
  await promisify(execFile)(path.join(root, 'ffmpeg/win32/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-n', input], { windowsHide: true });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  let window;
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, created) => {
    window = created; created.webContents.once('did-finish-load', resolve);
  }));
  await import(pathToFileURL(path.join(root, 'electron/main.js')).href); await ready;
  const js = async code => {
    try { return await window.webContents.executeJavaScript(code); }
    catch (error) { throw new Error(code.slice(0, 300) + '\n' + error.message); }
  };
  const wait = async code => {
    for (let i = 0; i < 200; i++) { if (await js(code)) return; await delay(50); }
    throw new Error('Timed out: ' + code);
  };
  const click = async text => {
    await js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
    await delay(30);
  };
  await click('Open video'); await wait('document.querySelector("video")?.readyState >= 2');
  await click('Export clip'); await click('Browse'); await click('Start Export');
  await wait('document.querySelector(".job-progress progress")?.value > 0'); await click('Cancel');
  await wait('document.body.textContent.includes("Export cancelled.")');
  assert.equal(await js('!!document.querySelector(".error-box")'), false);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  await fs.writeFile(path.join(dir, 'export-cancel.png'), (await window.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[aria-label="Close dialog"]').click()`);

  // Exercise the genuine File/Blob drop flow through React and chunked preload IPC.
  const bytes = await fs.readFile(input);
  // Test fixture only: constructing the synthetic browser File is distinct from app import transfer.
  await js(`window.fixtureBytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), ch => ch.charCodeAt(0));`);
  await js(`(() => {
    const file = new File([window.fixtureBytes], 'blob-source.mp4', {type:'video/mp4'});
    file.arrayBuffer = () => { throw new Error('Whole File read is forbidden'); };
    const data = new DataTransfer(); data.items.add(file);
    document.querySelector('.workspace-status').parentElement.dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:data}));
    delete window.fixtureBytes;
  })()`);
  await wait('document.querySelector(".source-name").textContent.includes("blob-source") && document.querySelector("video")?.readyState >= 2');
  const tempSource = await js('document.querySelector(".source-name").title');
  assert.equal((await fs.stat(tempSource)).size, bytes.length);
  assert.match(await js('document.body.textContent'), /Temporary video/);
  const importDirectory = path.dirname(tempSource);
  assert.equal((await fs.readdir(importDirectory)).some(file => /\.clipforge$/.test(file)), false);

  // Return to a permanent source, modify it, then close while an actual encode is active.
  await click('Open video');
  await wait(`document.querySelector('.source-name').title === ${JSON.stringify(input)}`);
  await js(`(() => {
    const el = document.querySelector('[aria-label="In point"]');
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2');
    el.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await delay(50);
  await js(`document.querySelector('[aria-label="In point"]').blur()`);
  const shutdownOutput = path.join(dir, 'shutdown.mp4');
  await js(`window.shutdownJob = window.electronAPI.exportVideo({jobId:'shutdown-smoke',inputPath:${JSON.stringify(input)},outputPath:${JSON.stringify(shutdownOutput)},
    startTime:0,duration:20,containerFormat:'mp4',mode:'crf',crfValue:23,preset:'veryslow',useGPU:false,copyAudio:false}); void 0;`);
  await delay(200);
  const report = { exportCancelControl: true, blobDropBytes: bytes.length, blobNoSidecar: true, nativeCloseRequested: true };
  // Synchronous quit observer runs only after main's guarded asynchronous cleanup has completed.
  app.once('quit', () => {
    try {
      assert.equal(fsSync.existsSync(shutdownOutput), false);
      assert.equal(fsSync.existsSync(tempSource), false);
      assert.equal(fsSync.readdirSync(dir).some(name => name.startsWith('.clipforge-output-')), false);
      const project = JSON.parse(fsSync.readFileSync(input.replace(/\.mp4$/, '-proj.clipforge'), 'utf8'));
      assert.equal(project.selection.inTime, 2);
      fsSync.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ ...report, shutdownCleanup: true, autosaveFlushed: true }, null, 2));
      console.log('SMOKE_PASSED', dir);
    } catch (error) { console.error(error); process.exitCode = 1; }
  });
  window.close();
  setTimeout(async () => {
    if (!window.isDestroyed()) {
      console.error('Close still pending:', await js('document.body.textContent'));
      app.exit(1);
    }
  }, 10000).unref();
}
main().catch(error => { console.error(error); app.exit(1); });
