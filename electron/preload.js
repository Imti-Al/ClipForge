const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Keep this allowlist local: a sandboxed preload cannot require application modules.
const requests = [
  "closeWindow",
  "openVideoDialog",
  "showOpenProjectDialog",
  "showSaveProjectDialog",
  "showSaveVideoDialogForSource",
  "selectMkvFiles",
  "showSaveVideoDialog",
  "getVideoInfo",
  "getExportEstimate",
  "getEncoderCapabilities",
  "beginImport",
  "writeImportChunk",
  "finishImport",
  "abortImport",
  "cancelMediaJob",
  "isTempImport",
  "moveFile",
  "projectDefaultPath",
  "projectExists",
  "projectOpenSidecar",
  "projectSaveSidecar",
  "projectSaveFile",
  "projectSetDeleteOnExit",
  "exportVideo",
  "remuxVideo"
];
const api = Object.fromEntries(requests.map(channel => [channel, (...args) => ipcRenderer.invoke(channel, ...args)]));
const subscribe = (channel, callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('electronAPI', {
  ...api,
  getPathForFile: file => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  onExportProgress: callback => subscribe('exportProgress', callback),
  onRemuxProgress: callback => subscribe('remuxProgress', callback),
  onCloseRequested: callback => subscribe('closeRequested', callback),
  platform: process.platform,
});
