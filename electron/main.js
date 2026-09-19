import { registerRequest } from './ipc.js';
import { TEMP_IMPORT_DIR, isTempImportPath, moveFile, cleanupOldTempFiles } from './files.js';
import { createImportStore } from './imports.js';
import { createJobManager } from './media/jobs.js';
import { stopProbes } from './media/probeProcesses.js';
import { randomUUID } from 'node:crypto';
import { PROJECT_EXT, sidecarPathForSource } from './projects/paths.js';
import { createProjectStore } from './projects/store.js';
import { cleanSafeFile } from './paths.js';
import { getVideoInfo } from './media/probe.js';
import { exportVideo, getExportEstimate } from './media/export.js';
import { getEncoderCapabilities } from './media/capabilities.js';
import { remuxVideo } from './media/remux.js';
import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged && process.env.VITE_DEV === "1";

// Keep a global reference of the window object
let mainWindow;

const projects = createProjectStore({ isTempImportPath });
const jobs = createJobManager();
const imports = createImportStore();
const approvedCloses = new WeakSet();
const pendingCloses = new WeakMap();
const handle = (channel, handler) => registerRequest(ipcMain, channel, handler);

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    clearTimeout(pendingCloses.get(window));
    pendingCloses.delete(window);
    mainWindow = null;
  });
  const owner = mainWindow.webContents.id;
  const window = mainWindow;
  window.on('close', event => {
    void jobs.cancelOwner(owner);
    if (approvedCloses.has(window)) return;
    // Keep the renderer alive while it flushes. Async work in beforeunload can be suspended.
    event.preventDefault();
    if (pendingCloses.has(window)) return;
    pendingCloses.set(window, setTimeout(() => {
      pendingCloses.delete(window);
      // A renderer that cannot acknowledge close cannot finish a project flush either.
      if (!window.isDestroyed()) window.destroy();
    }, 7000));
    if (!window.webContents.isDestroyed()) window.webContents.send('closeRequested');
  });
  mainWindow.webContents.once('destroyed', () => {
    void jobs.cancelOwner(owner).then(() => imports.cleanupOwner(owner));
  });
}

// App event listeners
app.whenReady().then(async () => {
  // Register a custom protocol to handle local video files
  protocol.registerFileProtocol('safe-file', (req, cb) => {
    const p = req.url.replace('safe-file:', '');
    cb({ path: path.normalize(p) });
  });
  
  // Create temp directory
  await fs.mkdir(TEMP_IMPORT_DIR, { recursive: true }).catch(() => {});
  
  // Clean up old temporary files on startup
  cleanupOldTempFiles().catch(console.error);
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let shutdownComplete = false;
let shutdownPending = false;
app.on('will-quit', event => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownPending) return;
  shutdownPending = true;
  stopProbes();
  let timer;
  void Promise.race([
    jobs.shutdown().then(() => Promise.allSettled([imports.shutdown(), projects.cleanupOnExit()])),
    new Promise(resolve => { timer = setTimeout(resolve, 6000); }),
  ]).finally(() => {
    clearTimeout(timer);
    shutdownComplete = true;
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
handle('closeWindow', (event, approved = true) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  clearTimeout(pendingCloses.get(window));
  pendingCloses.delete(window);
  if (!approved) return;
  approvedCloses.add(window);
  setTimeout(() => { if (!window.isDestroyed()) window.close(); }, 0);
});

// File dialog for opening videos
handle('openVideoDialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      {
        name: 'Video Files',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp']
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Show open project dialog
handle('showOpenProjectDialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'ClipForge Project Files', extensions: [PROJECT_EXT, 'llc'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

handle('showSaveProjectDialog', async (_e, defaultPath) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || `project.${PROJECT_EXT}`,
    filters: [
      { name: 'ClipForge Project Files', extensions: [PROJECT_EXT] },
      { name: 'ClipForge Legacy Project Files', extensions: ['llc'] },
    ],
  });
  return res.canceled ? null : res.filePath || null;
});

// Source-aware Save dialog
handle('showSaveVideoDialogForSource', async (_e, srcPath) => {
  const clean = cleanSafeFile(srcPath);
  const dir  = clean ? path.dirname(clean) : undefined;
  const base = clean ? path.basename(clean) : 'video.mp4';
  const res  = await dialog.showSaveDialog({
    defaultPath: dir && base ? path.join(dir, base) : undefined,
    filters: [
      { name: 'Video Files', extensions: ['mp4','mkv','avi','mov','webm','m4v'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePath || null;
});

handle('beginImport', (event, id, name, size) => imports.begin(event.sender.id, id, name, size));
handle('writeImportChunk', (event, id, offset, bytes) => imports.chunk(event.sender.id, id, offset, bytes));
handle('finishImport', (event, id) => imports.finish(event.sender.id, id));
handle('abortImport', (event, id) => imports.abort(event.sender.id, id));
handle('isTempImport', (_event, source) => isTempImportPath(source));
handle('moveFile', (_event, source, destination) => moveFile(source, destination));
handle('projectDefaultPath', (_event, source) => sidecarPathForSource(source));
handle('projectExists', (_event, projectPath) => projects.exists(projectPath));
handle('projectOpenSidecar', (_event, projectPath) => projects.read(projectPath));
handle('projectSaveSidecar', async (_event, source, data) => ({ path: await projects.saveSidecar(source, data) }));
handle('projectSaveFile', async (_event, projectPath, data) => ({ path: await projects.saveFile(projectPath, data) }));
handle('projectSetDeleteOnExit', (_event, projectPath, enabled) => projects.setDeleteOnExit(projectPath, enabled));

// Media services report progress through the existing renderer channels.
handle('getVideoInfo', (_e, source) => getVideoInfo(source));
handle('getExportEstimate', (_e, options) => getExportEstimate(options));
handle('getEncoderCapabilities', () => getEncoderCapabilities());
const mediaJob = (event, options, channel, execute) => {
  const jobId = options.jobId || randomUUID();
  return jobs.run(event.sender?.id, jobId, signal => execute(options, data => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, { ...data, jobId });
  }, signal));
};
handle('cancelMediaJob', (event, jobId) => jobs.cancel(event.sender.id, jobId));
handle('exportVideo', (event, options) => mediaJob(event, options, 'exportProgress', exportVideo));
handle('remuxVideo', (event, options) => mediaJob(event, options, 'remuxProgress', remuxVideo));

// File dialog for selecting multiple MKV files for remux
handle('selectMkvFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'MKV Files', extensions: ['mkv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths;
  }
  return [];
});

// File dialog for selecting save location
handle('showSaveVideoDialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'video.mp4',
    filters: [
      { name: 'Export Video Files', extensions: ['mp4', 'mkv'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    return result.filePath;
  }
  return null;
});
