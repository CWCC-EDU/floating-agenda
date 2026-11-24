const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  focusWindow: () => ipcRenderer.invoke('window:focus'),
  setInteractionActive: (active) => ipcRenderer.invoke('desktop:interactive', active),
  beginInput: () => ipcRenderer.invoke('desktop:begin-input'),
  setWindowAdjustmentMode: (enabled) => ipcRenderer.invoke('window:adjust-mode', enabled),
  startWindowAdjustment: (mode, resizeEdges) => ipcRenderer.invoke('window:adjust-start', mode, resizeEdges),
  updateWindowAdjustment: () => ipcRenderer.invoke('window:adjust-update'),
  stopWindowAdjustment: () => ipcRenderer.invoke('window:adjust-stop'),
  quitApp: () => ipcRenderer.invoke('window:quit'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  syncGetStatus: () => ipcRenderer.invoke('sync:status'),
  syncConnect: (payload) => ipcRenderer.invoke('sync:connect', payload),
  syncDisconnect: () => ipcRenderer.invoke('sync:disconnect'),
  syncSetAutoSync: (enabled) => ipcRenderer.invoke('sync:auto', enabled),
  syncNow: (state, options) => ipcRenderer.invoke('sync:now', state, options),
  syncNotes: (payload) => ipcRenderer.send('notes:sync', payload),
  noteReady: (id) => ipcRenderer.send('note:ready', id),
  sendNoteChange: (id, patch) => ipcRenderer.send('note:change', { id, patch }),
  closeNote: (id) => ipcRenderer.send('note:close', id),
  deleteNote: (id) => ipcRenderer.send('note:delete', id),
  newNote: () => ipcRenderer.send('note:new'),
  focusNote: (id) => ipcRenderer.send('note:focus', id),
  onNoteState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('note:state', listener);
    return () => ipcRenderer.removeListener('note:state', listener);
  },
  onNotesPatch: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('notes:patch', listener);
    return () => ipcRenderer.removeListener('notes:patch', listener);
  },
  onNotesOpenChanged: (callback) => {
    const listener = (_event, id, open) => callback(id, open);
    ipcRenderer.on('notes:open-changed', listener);
    return () => ipcRenderer.removeListener('notes:open-changed', listener);
  },
  onNotesDeleted: (callback) => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('notes:deleted', listener);
    return () => ipcRenderer.removeListener('notes:deleted', listener);
  },
  onNotesCreate: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('notes:create', listener);
    return () => ipcRenderer.removeListener('notes:create', listener);
  },
  startNoteDrag: (id) => ipcRenderer.send('note:drag-start', id),
  dragNoteWindow: (id) => ipcRenderer.send('note:drag-move', id),
  endNoteDrag: (id) => ipcRenderer.send('note:drag-end', id),
  resizeNoteWindow: (id, height) => ipcRenderer.send('note:resize', id, height),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});