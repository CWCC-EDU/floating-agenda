const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  setWindowAdjustmentMode: (enabled) => ipcRenderer.invoke('window:adjust-mode', enabled),
  startWindowAdjustment: (mode, resizeEdges) => ipcRenderer.invoke('window:adjust-start', mode, resizeEdges),
  updateWindowAdjustment: () => ipcRenderer.invoke('window:adjust-update'),
  stopWindowAdjustment: () => ipcRenderer.invoke('window:adjust-stop'),
  quitApp: () => ipcRenderer.invoke('window:quit'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
