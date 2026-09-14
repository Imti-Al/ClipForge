// Run: electron tests/tools/ui-smoke.cjs [optional source fixture]
// Uses production UI, actual preload/IPC/services; only native picker responses are supplied.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const root = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-ui-'));
  // Isolate app temp cleanup from any user imports.
  app.setPath('temp', dir);
  const profile = path.join(dir, 'profile');
  await fs.mkdir(profile);
  app.setPath('userData', profile);
  process.env.TEMP = dir;
  process.env.TMP = dir;
  const input = path.join(dir, 'local-recording.mp4');
  const ffmpeg = path.join(root, 'ffmpeg/win32/ffmpeg.exe');
  if (process.argv[2]) await fs.copyFile(process.argv[2], input);
  else await promisify(execFile)(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-n', input], { windowsHide: true });
  const mkv = path.join(dir, 'recording-a.mkv'), second = path.join(dir, 'recording-b.mkv');
  await promisify(execFile)(ffmpeg, ['-v', 'error', '-i', input, '-t', '3', '-c', 'copy', '-n', mkv], { windowsHide: true });
  await fs.copyFile(mkv, second);
  let savePath = path.join(dir, 'export.mp4');
  dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.properties.includes('multiSelections') ? [mkv, second] : [input] });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath });
  let window;
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, created) => {
    window = created;
    created.webContents.once('did-finish-load', resolve);
  }));
  await import(pathToFileURL(path.join(root, 'electron/main.js')).href);
  await ready;
  const errors = [];
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = async code => {
    try { return await window.webContents.executeJavaScript(code); }
    catch (error) { throw new Error(code + '\n' + error.message); }
  };
  const waitFor = async code => {
    for (let i = 0; i < 150; i++) { if (await js(code)) return; await delay(100); }
    throw new Error('Timed out: ' + code);
  };
  const click = async selector => { await js('document.querySelector(' + JSON.stringify(selector) + ').click()'); await delay(100); };
  const textClick = async text => { await js('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === ' + JSON.stringify(text) + ').click()'); await delay(100); };
  const inputValue = async (selector, value) => {
    await js('(()=>{const el=document.querySelector(' + JSON.stringify(selector) + '); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,' + JSON.stringify(value) + '); el.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await delay(50);
    await js('document.querySelector(' + JSON.stringify(selector) + ').blur()'); await delay(100);
  };
  const shots = [];
  const capture = async name => {
    await delay(250);
    const file = path.join(dir, name + '.png');
    await fs.writeFile(file, (await window.webContents.capturePage()).toPNG());
    const bounds = await js('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:!!document.querySelector(".dialog-panel") && document.querySelector(".dialog-panel").getBoundingClientRect().bottom>innerHeight})');
    assert.equal(bounds.overflow, false); assert.equal(bounds.dialogOverflow, false);
    shots.push({ name, file, ...bounds });
  };
  await capture('empty-1400');
  await textClick('Open video');
  await waitFor('document.querySelector("video")?.readyState >= 2 && document.querySelectorAll(".clip-row").length === 1');
  await inputValue('[aria-label="In point"]', '1');
  await inputValue('[aria-label="Out point"]', '9');
  await click('[aria-label="Add clip"]');
  await waitFor('document.querySelectorAll(".clip-row").length === 2');
  await click('.clip-tab');
  await textClick('File'); await capture('file-menu'); await textClick('File');
  assert.equal(await js('document.querySelectorAll(".clip-tab.active").length'), 1);
  await click('[aria-label="Next frame"]');
  await waitFor('document.querySelector("video").currentTime > 0.02');
  assert.ok(await js('document.querySelector("video").currentTime < 0.1'));
  for (const [width, height] of [[1400,900],[1200,700],[1920,1080]]) {
    window.setSize(width, height); await capture('editor-' + width);
  }
  window.setSize(1200,700);
  await textClick('Export clip');
  await waitFor('document.querySelector("[role=dialog]")');
  const before = await js('document.querySelector(".time-field input").value');
  await js('window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyI",key:"i",bubbles:true})); window.dispatchEvent(new KeyboardEvent("keydown",{code:"Space",key:" ",bubbles:true}))');
  assert.equal(await js('document.querySelector(".time-field input").value'), before);
  assert.equal(await js('document.querySelector("video").paused'), true);
  await capture('export-quality-1200');
  await js('Array.from(document.querySelectorAll(".mode-choices button"))[1].click()'); await delay(100);
  await inputValue('#target-size', '1');
  await waitFor('document.querySelector(".estimate-summary strong").textContent.includes("MB")');
  await capture('export-target-1200');
  await click('.advanced-settings summary');
  await js('document.querySelector(".advanced-settings").scrollIntoView({block:"end"})');
  await capture('export-advanced-1200');
  await textClick('Browse');
  await textClick('Start Export');
  await waitFor('document.querySelector(".job-progress")');
  await capture('export-running');
  await waitFor('!document.querySelector("[role=dialog]")');
  assert.ok((await fs.stat(savePath)).size > 0);
  await textClick('Export clip'); await textClick('Browse'); await textClick('Start Export');
  await waitFor('document.querySelector(".error-box")?.textContent.includes("already exists")');
  await capture('export-collision');
  await click('[aria-label="Close dialog"]');
  await textClick('Remux');
  await textClick('Add files');
  await waitFor('document.querySelectorAll(".remux-item").length === 2');
  await capture('remux-queued');
  await js('document.querySelector(".dialog-footer .primary-button").click()');
  await waitFor('Array.from(document.querySelectorAll(".remux-state")).every(e=>e.textContent.includes("Completed"))');
  await capture('remux-complete');
  await textClick('Clear finished');
  await textClick('Add files');
  await waitFor('document.querySelectorAll(".remux-item").length === 2');
  await js('document.querySelector(".dialog-footer .primary-button").click()');
  await waitFor('document.querySelectorAll(".remux-error").length === 2');
  await capture('remux-collisions');
  await click('[aria-label="Close dialog"]');
  // Native file drag path, without reading the user's recording or exposing Node in the renderer.
  await js('(()=>{const dt=new DataTransfer();dt.setData("text/plain",' + JSON.stringify(input) + ');document.querySelector(".preview-region").dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:dt}));})()');
  await delay(1200);
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({ shots, errors, checks: ['open/probe', 'multi-segment selection', 'in/out editing', 'paused frame step', 'modal shortcut isolation', 'real CPU export', 'collision error', 'multi-file remux', 'local-path drop'] }, null, 2));
  console.log('UI_REPORT', dir);
  // Teardown is not a test of native window-close/autosave behavior.
  window.destroy();
  app.exit(0);
}
main().catch(error => { console.error(error); app.exit(1); });
