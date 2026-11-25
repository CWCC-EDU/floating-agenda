const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  repairDesktopInput: () => ipcRenderer.invoke('desktop:repair-input'),
  openQuickCapture: () => ipcRenderer.invoke('quick:open'),
  closeQuickCapture: () => ipcRenderer.invoke('quick:close'),
  submitQuickTask: (id, draft) => ipcRenderer.invoke('quick:submit', id, draft),
  openDrawingBoard: () => ipcRenderer.invoke('drawing:open'),
  exportDrawing: (bytes) => ipcRenderer.invoke('drawing:export', bytes),
  saveDrawingNote: (id, bytes) => ipcRenderer.invoke('drawing:note', id, bytes),
  onWorkspaceRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('workspace:add', listener);
    return () => ipcRenderer.removeListener('workspace:add', listener);
  },
  workspaceReady: () => ipcRenderer.send('workspace:ready'),
  workspaceSaved: (requestId, saved) => ipcRenderer.send('workspace:saved', requestId, saved),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  loadThemeImage: () => ipcRenderer.invoke('theme:load'),
  saveThemeImage: (bytes) => ipcRenderer.invoke('theme:save', bytes),
  focusCalendarInput: () => ipcRenderer.invoke('calendar:focus-input'),
  getCalendarDisplays: () => ipcRenderer.invoke('calendar:get-displays'),
  setCalendarDisplay: (preference) => ipcRenderer.invoke('calendar:set-display', preference),
  onCalendarDisplays: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('calendar:displays-changed', listener);
    return () => ipcRenderer.removeListener('calendar:displays-changed', listener);
  },
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
  syncSetInterval: (intervalMinutes) => ipcRenderer.invoke('sync:interval', intervalMinutes),
  syncFinishPull: (id, state) => ipcRenderer.invoke('sync:finish-pull', id, state),
  syncNow: (state, options) => ipcRenderer.invoke('sync:now', state, options),
  syncNotes: (payload) => ipcRenderer.send('notes:sync', payload),
  showNoteFormatMenu: (id, x, y, hasSelection) => ipcRenderer.send('note:format-menu', { id, x, y, hasSelection }),
  onNoteFormat: (callback) => {
    const listener = (_event, format) => callback(format);
    ipcRenderer.on('note:format', listener);
    return () => ipcRenderer.removeListener('note:format', listener);
  },
  noteReady: (id) => ipcRenderer.invoke('note:ready', id),
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
  startNoteDrag: (id, x, y) => ipcRenderer.send('note:drag-start', id, x, y),
  moveNoteDrag: (id) => ipcRenderer.send('note:drag-move', id),
  endNoteDrag: (id) => ipcRenderer.send('note:drag-end', id),
  resizeNoteWindow: (id, height) => ipcRenderer.send('note:resize', id, height),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
