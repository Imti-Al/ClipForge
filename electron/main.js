import { registerRequest } from './ipc.js';
import { TEMP_IMPORT_DIR, isTempImportPath, importBlob, moveFile, cleanupOldTempFiles } from './files.js';
import { PROJECT_EXT, sidecarPathForSource } from './projects/paths.js';
import { createProjectStore } from './projects/store.js';
import { cleanSafeFile } from './paths.js';
import { getVideoInfo } from './media/probe.js';
import { exportVideo } from './media/export.js';
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
    mainWindow = null;
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

app.on('will-quit', async () => {
  // Clean up temp directory
  try { await fs.rm(TEMP_IMPORT_DIR, { recursive: true, force: true }); } catch {}
  // Delete project files marked for deletion
  await projects.cleanupOnExit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

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

handle('importBlob', (_event, bytes, name) => importBlob(bytes, name));
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
handle('exportVideo', (event, options) => exportVideo(options, data => event.sender.send('exportProgress', data)));
handle('remuxVideo', (event, options) => remuxVideo(options, data => event.sender.send('remuxProgress', data)));

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
