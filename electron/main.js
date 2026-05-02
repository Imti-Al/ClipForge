import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.VITE_DEV === "1";

// Keep a global reference of the window object
let mainWindow;

// Top-level helpers & constants
const TEMP_IMPORT_DIR = path.join(os.tmpdir(), 'ClipForgeImports');
const PROJECT_EXT = 'clipforge';
const norm = (p) => path.normalize(p).replace(/\\/g, '/').toLowerCase();
const isUnder = (p, root) => norm(p).startsWith(norm(root) + '/');
const cleanSafeFile = (p) => (p?.startsWith('safe-file:') ? p.replace('safe-file:', '') : p);
const isTempImportPath = (src) => !!src && isUnder(norm(cleanSafeFile(src)), norm(TEMP_IMPORT_DIR));
const sidecarPathForSource = (src) => {
  const parsed = path.parse(cleanSafeFile(src));
  return path.join(parsed.dir, `${parsed.name}-proj.${PROJECT_EXT}`);
};
const withProjectMetadata = (data) => ({
  ...data,
  version: data?.version || '1.0.0',
  createdAt: data?.createdAt || new Date().toISOString(),
  lastModified: new Date().toISOString(),
});

// Delete-on-exit tracking
const deleteOnExit = new Set();

// Clean up old temporary files on startup
async function cleanupOldTempFiles() {
  try {
    await fs.access(TEMP_IMPORT_DIR);
    const files = await fs.readdir(TEMP_IMPORT_DIR);
    
    for (const file of files) {
      const filePath = path.join(TEMP_IMPORT_DIR, file);
      try {
        const stats = await fs.stat(filePath);
        const now = Date.now();
        const fileAge = now - stats.mtime.getTime();
        
        // Delete files older than 24 hours
        if (fileAge > 24 * 60 * 60 * 1000) {
          await fs.unlink(filePath);
          console.log('Cleaned up old temp file:', filePath);
        }
      } catch (error) {
        console.error('Error processing temp file:', filePath, error);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be accessed - that's fine
    if (error.code !== 'ENOENT') {
      console.error('Error during temp file cleanup:', error);
    }
  }
}

// Determine the path to FFmpeg executables
function getFFmpegPath() {
  const platform = os.platform();
  const arch = os.arch();
  
  // Try multiple possible locations for FFmpeg binaries
  const platformDir = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  const extension = platform === 'win32' ? '.exe' : '';
  
  // Possible locations to check for FFmpeg binaries
  const possibleDirs = [
    // Current directory structure
    path.join(__dirname, 'ffmpeg', platformDir),
    // Project root ffmpeg directory
    path.join(__dirname, '..', 'ffmpeg', platformDir),
    // If running from dist
    path.join(process.cwd(), 'ffmpeg', platformDir),
    // If binaries are in the same directory as the executable
    path.join(__dirname, platformDir),
  ];
  
  // Function to check if a binary exists
  const findBinary = (name) => {
    const binaryName = `${name}${extension}`;
    
    // First try the possible directories
    for (const dir of possibleDirs) {
      const fullPath = path.join(dir, binaryName);
      if (fsSync.existsSync(fullPath)) {
        console.log(`Found ${name} at: ${fullPath}`);
        return fullPath;
      }
    }
    
    // If not found in any directory, try system PATH
    console.log(`${name} not found in expected locations, falling back to system PATH`);
    return binaryName;
  };
  
  return {
    ffmpeg: findBinary('ffmpeg'),
    ffprobe: findBinary('ffprobe'),
    ffplay: findBinary('ffplay')
  };
}

// FFprobe helpers
const parseFrac = (s) => {
  if (!s || s === '0/0') return undefined;
  const [n,d] = s.split('/').map(Number);
  return d ? n/d : undefined;
};

const ffprobeJSON = (filePath) => new Promise((resolve, reject) => {
  const ffprobe = process.env.FFPROBE_PATH || (process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  execFile(ffprobe, ['-v','quiet','-print_format','json','-show_format','-show_streams', filePath],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => err ? reject(err) : resolve(JSON.parse(stdout))
  );
});

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function mapNvencPreset(preset) {
  const p = String(preset || 'medium').toLowerCase();
  // NVENC presets (newer ffmpeg): p1..p7 (fastest..slowest).
  // Map common x264 presets to a reasonable NVENC equivalent.
  switch (p) {
    case 'ultrafast': return 'p1';
    case 'superfast': return 'p2';
    case 'veryfast': return 'p3';
    case 'faster': return 'p4';
    case 'fast': return 'p4';
    case 'medium': return 'p5';
    case 'slow': return 'p6';
    case 'slower': return 'p7';
    case 'veryslow': return 'p7';
    default: return 'p5';
  }
}

function normalizeOutPath(p) {
  if (!p) return '';
  // Handles mixed slashes like "C:\out/foo.mp4"
  return path.normalize(String(p));
}


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
  for (const p of deleteOnExit) { try { await fs.unlink(p); } catch {} }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// File dialog for opening videos
ipcMain.handle('open-video-dialog', async () => {
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
ipcMain.handle('showOpenProjectDialog', async () => {
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

ipcMain.handle('showSaveProjectDialog', async (_e, defaultPath) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || `project.${PROJECT_EXT}`,
    filters: [
      { name: 'ClipForge Project Files', extensions: [PROJECT_EXT] },
      { name: 'LosslessCut Project Files', extensions: ['llc'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePath || null;
});

// Source-aware Save dialog
ipcMain.handle('showSaveVideoDialogForSource', async (_e, srcPath) => {
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

// Blob import (drag from cloud/web) → temp file
ipcMain.handle('import-blob', async (_e, bytes, name) => {
  try {
    await fs.mkdir(TEMP_IMPORT_DIR, { recursive: true });
    const originalName = String(name || 'drop');
    const ext = path.extname(originalName) || '';
    const base = path.basename(originalName, ext) || 'drop';
    const safeBase = base
      .replace(/[^\w.\-]+/g, '_')
      .replace(/_+/g, '_');
    const safeExt = ext.replace(/[^\w.]+/g, '');
    const filePath = path.join(TEMP_IMPORT_DIR, `${Date.now()}-${safeBase}${safeExt}`);
    // bytes may be a Uint8Array or ArrayBuffer – handle both
    const buf = bytes?.buffer instanceof ArrayBuffer
    ? Buffer.from(bytes.buffer)
    : Buffer.from(bytes);

    await fs.writeFile(filePath, buf);
    return { success: true, tempPath: filePath, isTemp: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Check if path is a temporary import
ipcMain.handle('isTempImport', (_e, src) => isTempImportPath(src));
ipcMain.handle('is-temp-import', (_e, src) => isTempImportPath(src)); // alias

// Get default project path for a video file
ipcMain.handle('projectDefaultPath', (_e, src) => sidecarPathForSource(src));
ipcMain.handle('project-default-path', (_e, src) => sidecarPathForSource(src)); // alias

// Check if project file exists
ipcMain.handle('projectExists', async (_e, projPath) => {
  try { await fs.access(projPath); return true; } catch { return false; }
});
ipcMain.handle('project-exists', async (_e, projPath) => {
  try { await fs.access(projPath); return true; } catch { return false; }
}); // alias

// Open project sidecar file
ipcMain.handle('projectOpenSidecar', async (_e, projPath) => {
  try { 
    const txt = await fs.readFile(projPath, 'utf8'); 
    return { success: true, data: JSON.parse(txt) }; 
  }
  catch (err) { 
    return { success: false, error: String(err) }; 
  }
});
ipcMain.handle('project-open-sidecar', async (_e, projPath) => {
  try { 
    const txt = await fs.readFile(projPath, 'utf8'); 
    return { success: true, data: JSON.parse(txt) }; 
  }
  catch (err) { 
    return { success: false, error: String(err) }; 
  }
}); // alias

// Save project data as sidecar next to video
ipcMain.handle('projectSaveSidecar', async (_e, src, data) => {
  try {
    if (!src) throw new Error('Missing source path');
    if (isTempImportPath(src)) throw new Error('Cannot save sidecar next to temporary file. Use "Save Video & Project…" first.');
    const out = sidecarPathForSource(src);
    const tmp = out + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(withProjectMetadata(data), null, 2), 'utf8');
    await fs.rename(tmp, out);
    return { success: true, path: out };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
ipcMain.handle('project-save-sidecar', async (_e, src, data) => {
  try {
    if (!src) throw new Error('Missing source path');
    if (isTempImportPath(src)) throw new Error('Cannot save sidecar next to temporary file. Use "Save Video & Project…" first.');
    const out = sidecarPathForSource(src);
    const tmp = out + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(withProjectMetadata(data), null, 2), 'utf8');
    await fs.rename(tmp, out);
    return { success: true, path: out };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}); // alias

ipcMain.handle('projectSaveFile', async (_e, projectPath, data) => {
  try {
    if (!projectPath) throw new Error('Missing project path');
    const tmp = projectPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(withProjectMetadata(data), null, 2), 'utf8');
    await fs.rename(tmp, projectPath);
    return { success: true, path: projectPath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Cross-device safe move
ipcMain.handle('moveFile', async (_e, src, dst) => {
  try {
    try { await fs.rename(src, dst); }
    catch (e) {
      if (e && e.code === 'EXDEV') { await fs.copyFile(src, dst); await fs.unlink(src); }
      else throw e;
    }
    return { success: true, dst };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
ipcMain.handle('move-file', async (_e, src, dst) => {
  try {
    try { await fs.rename(src, dst); }
    catch (e) {
      if (e && e.code === 'EXDEV') { await fs.copyFile(src, dst); await fs.unlink(src); }
      else throw e;
    }
    return { success: true, dst };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}); // alias

// Set delete-on-exit for project files
ipcMain.handle('projectSetDeleteOnExit', (_e, projPath, enabled) => {
  if (!projPath) return false;
  if (enabled) deleteOnExit.add(projPath); else deleteOnExit.delete(projPath);
  return true;
});
ipcMain.handle('project-set-delete-on-exit', (_e, projPath, enabled) => {
  if (!projPath) return false;
  if (enabled) deleteOnExit.add(projPath); else deleteOnExit.delete(projPath);
  return true;
}); // alias

// Get video information using ffprobe (robust version)
ipcMain.handle('get-video-info', async (_e, p) => {
  const filePath = cleanSafeFile(p);
  try {
    const raw = await ffprobeJSON(filePath);
    const fmt = raw?.format ?? {};
    const streams = raw?.streams ?? [];
    const v = streams.find(s => s.codec_type === 'video');
    const a = streams.find(s => s.codec_type === 'audio');

    const fps =
      parseFrac(v?.avg_frame_rate) ??
      parseFrac(v?.r_frame_rate) ??
      (Number.isFinite(v?.fps) ? Number(v?.fps) : undefined);

    const duration = Number(fmt.duration) || 0;
    const size = Number(fmt.size) || 0;
    const bitrate =
      Number(fmt.bit_rate) ||
      Number(v?.bit_rate) ||
      (duration > 0 && size > 0 ? Math.round((size * 8) / duration) : 0);

    return {
      duration,
      size,
      bitrate,
      video: v ? {
        codec: v.codec_name || v.codec_tag_string || 'unknown',
        width: Number(v.width) || 0,
        height: Number(v.height) || 0,
        fps: fps || 0,
        pixelFormat: v.pix_fmt || 'unknown',
      } : null,
      audio: a ? {
        codec: a.codec_name || a.codec_tag_string || 'unknown',
        channels: Number(a.channels) || 0,
        sampleRate: Number(a.sample_rate) || 0,
        bitrate: Number(a.bit_rate) || 0,
      } : null,
      path: filePath,
    };
  } catch (err) {
    console.error('ffprobe failed:', err);
    return { duration:0, size:0, bitrate:0, video:null, audio:null, path:filePath };
  }
});

// Export video with ffmpeg
ipcMain.handle('export-video', async (event, options) => {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath().ffmpeg;
    
    const {
      inputPath,
      outputPath,
      startTime,
      duration,
      endTime,
      containerFormat,
      format,
      mode, // 'crf' or 'target'
      crfValue,
      targetSize,
      preset,
      useGPU,
      useGpu,
      copyAudio
    } = options;
    const cleanInputPath = cleanSafeFile(inputPath);
    const exportDuration = Number(duration) > 0
      ? Number(duration)
      : (Number(endTime) > Number(startTime) ? Number(endTime) - Number(startTime) : 0);
    const cleanOutputPath = normalizeOutPath(outputPath);
    const outputFormat = (containerFormat || format || path.extname(cleanOutputPath).replace('.', '') || 'mp4').toLowerCase();
    const gpuEnabled = Boolean(useGPU ?? useGpu);

    if (!cleanInputPath) return reject(new Error('Missing inputPath'));
    if (!cleanOutputPath) return reject(new Error('Missing outputPath'));
    if (!Number.isFinite(exportDuration) || exportDuration <= 0) {
      return reject(new Error('Invalid export duration (segment length must be > 0)'));
    }

    let args = ['-i', cleanInputPath];
    
    // Add start time and duration for trimming
    if (Number(startTime) > 0) {
      args.push('-ss', startTime.toString());
    }
    args.push('-t', exportDuration.toString());

    // Video encoding options
    if (mode === 'crf') {
      if (gpuEnabled) {
        // NVENC doesn't support x264-style CRF. Use VBR + CQ as a comparable quality slider.
        const cq = clamp(crfValue, 0, 51);
        args.push(
          '-c:v', 'h264_nvenc',
          '-preset', mapNvencPreset(preset),
          '-rc', 'vbr',
          '-cq', String(cq)
        );
      } else {
        args.push('-c:v', 'libx264', '-crf', String(clamp(crfValue, 0, 51)), '-preset', String(preset || 'medium').toLowerCase());
      }
    } else if (mode === 'target' || mode === 'targetSize') {
      // Calculate target bitrate based on target size and duration
      const safeTargetSize = clamp(targetSize, 1, 100000); // MB
      const targetBitrate = Math.floor((safeTargetSize * 8 * 1024) / exportDuration); // kbps
      if (gpuEnabled) {
        args.push(
          '-c:v', 'h264_nvenc',
          '-preset', mapNvencPreset(preset),
          '-b:v', `${targetBitrate}k`
        );
      } else {
        args.push('-c:v', 'libx264', '-b:v', `${targetBitrate}k`, '-preset', String(preset || 'medium').toLowerCase());
      }
    }

    // Audio options
    if (copyAudio) {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    // Output format
    args.push('-f', outputFormat);
    
    // Overwrite output file
    args.push('-y');
    
    // Output path
    args.push(cleanOutputPath);

    console.log('FFmpeg command:', ffmpegPath, args.join(' '));

    const ffmpeg = spawn(ffmpegPath, args);
    let error = '';

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      error += output;
      
      // Parse progress from ffmpeg output
      const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        const progress = exportDuration > 0 ? Math.min((currentTime / exportDuration) * 100, 100) : 0;
        
        // Send progress update to renderer
        event.sender.send('export-progress', {
          progress: Math.round(progress),
          currentTime,
          speed: output.match(/speed=\s*(\d+\.?\d*)x/) ? parseFloat(output.match(/speed=\s*(\d+\.?\d*)x/)[1]) : 1
        });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, outputPath: cleanOutputPath });
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${error}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg: ${err.message}`));
    });
  });
});

// Remux video (MKV to MP4)
ipcMain.handle('remux-video', async (event, options) => {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath().ffmpeg;
    
    const { inputPath, outputPath, duration } = options;
    const cleanInputPath = cleanSafeFile(inputPath);
    const totalDuration = Number(duration) > 0 ? Number(duration) : 0;

    const args = [
      '-i', cleanInputPath,
      '-c', 'copy', // Copy streams without re-encoding
      '-y', // Overwrite output file
      outputPath
    ];

    console.log('FFmpeg remux command:', ffmpegPath, args.join(' '));

    const ffmpeg = spawn(ffmpegPath, args);
    let error = '';

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      error += output;
      
      // Parse progress for remux
      const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        const progress = totalDuration > 0 ? Math.min(99, Math.round((currentTime / totalDuration) * 100)) : undefined;
        
        // Send progress update to renderer
        event.sender.send('remux-progress', {
          inputPath,
          currentTime,
          speed: output.match(/speed=\s*(\d+\.?\d*)x/) ? parseFloat(output.match(/speed=\s*(\d+\.?\d*)x/)[1]) : 1,
          progress
        });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, outputPath });
      } else {
        reject(new Error(`FFmpeg remux failed with code ${code}: ${error}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg for remux: ${err.message}`));
    });
  });
});

// File dialog for selecting output directory
ipcMain.handle('select-output-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// File dialog for selecting multiple MKV files for remux
ipcMain.handle('select-mkv-files', async () => {
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
ipcMain.handle('show-save-video-dialog', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'video.mp4',
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    return result.filePath;
  }
  return null;
});
