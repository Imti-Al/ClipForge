const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openVideoDialog: () => ipcRenderer.invoke('open-video-dialog'),
  showOpenProjectDialog: () => ipcRenderer.invoke('showOpenProjectDialog'),
  showSaveProjectDialog: (defaultPath) => ipcRenderer.invoke('showSaveProjectDialog', defaultPath),
  showSaveVideoDialogForSource: (src) => ipcRenderer.invoke('showSaveVideoDialogForSource', src),
  selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),
  selectMkvFiles: () => ipcRenderer.invoke('select-mkv-files'),
  showSaveVideoDialog: (defaultPath) => ipcRenderer.invoke('show-save-video-dialog', defaultPath),

  // Drag/drop helpers (Electron 32+ removed File.path for dropped files)
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return null; }
  },
  
  // Video information
  getVideoInfo: (videoPath) => ipcRenderer.invoke('get-video-info', videoPath),
  
  // Import operations
  importBlob: (bytes, name) => ipcRenderer.invoke('import-blob', bytes, name),
  isTempImport: (srcPath) => ipcRenderer.invoke('isTempImport', srcPath),
  moveFile: (src, dst) => ipcRenderer.invoke('move-file', src, dst),
  
  // Project file operations
  projectDefaultPath: (src) => ipcRenderer.invoke('projectDefaultPath', src),
  projectExists: (p) => ipcRenderer.invoke('projectExists', p),
  projectOpenSidecar: (p) => ipcRenderer.invoke('projectOpenSidecar', p),
  projectSaveSidecar: (src, data) => ipcRenderer.invoke('projectSaveSidecar', src, data),
  projectSaveFile: (projectPath, data) => ipcRenderer.invoke('projectSaveFile', projectPath, data),
  projectSetDeleteOnExit: (p, enabled) => ipcRenderer.invoke('projectSetDeleteOnExit', p, enabled),
  
  // Export operations
  exportVideo: (options) => ipcRenderer.invoke('export-video', options),
  onExportProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
  removeExportProgressListener: () => {
    ipcRenderer.removeAllListeners('export-progress');
  },
  
  // Remux operations
  remuxVideo: (options) => ipcRenderer.invoke('remux-video', options),
  onRemuxProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('remux-progress', listener);
    return () => ipcRenderer.removeListener('remux-progress', listener);
  },
  removeRemuxProgressListener: () => {
    ipcRenderer.removeAllListeners('remux-progress');
  },
  
  // Platform info
  platform: process.platform,
  
  // Legacy aliases for compatibility
  'project-default-path': (srcPath) => ipcRenderer.invoke('project-default-path', srcPath),
  'project-save-sidecar': (srcPath, projectData) => ipcRenderer.invoke('project-save-sidecar', srcPath, projectData),
  'project-open-sidecar': (projectPath) => ipcRenderer.invoke('project-open-sidecar', projectPath),
  'project-exists': (projectPath) => ipcRenderer.invoke('project-exists', projectPath),
  'project-set-delete-on-exit': (projectPath, enabled) => ipcRenderer.invoke('project-set-delete-on-exit', projectPath, enabled),
  'is-temp-import': (srcPath) => ipcRenderer.invoke('is-temp-import', srcPath),
  'move-file': (src, dst) => ipcRenderer.invoke('move-file', src, dst)
});
