const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, screen, session, Tray } = require('electron');
const { maintainDesktopOrder, moveNoteWindow, repairDesktopInput, stopDesktopOrder } = require('./desktop-order.cjs');
const { MIN_CALENDAR_WIDTH, MIN_CALENDAR_HEIGHT, calendarIsReachable, placeCalendar, resizeCalendar } = require('./calendar-bounds.cjs');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const nutstore = require('./nutstore.cjs');
const { createUtilityWindows } = require('./utility-windows.cjs');

let mainWindow = null;
let tray = null;
let currentFilter = 'all';
let isQuitting = false;
let latestSettings = {
  desktopIconLayer: 'below',
  autoNumber: true,
  showWeekNumbers: true,
  showLunar: true,
  rolloverEnabled: true,
  autoStartEnabled: false,
  autoCheckUpdates: false,
  proxyEnabled: false,
  proxyServer: '',
  showHideShortcut: 'Control+Shift+Space',
  quickCaptureShortcut: '',
  toggleContentShortcut: '',
  toggleNotesShortcut: 'Control+Alt+B',
  showNotesOnTaskbar: true,
  completeTaskShortcut: '',
};
let adjustment = null;
let integrationSignature = '';
let stateWrites = Promise.resolve();
let desktopOrderTimer = null;
let displayChangeTimer = null;
let calendarDisplayPreference = 'primary';
let windowBoundsWrites = Promise.resolve();
let calendarRequested = false;
let noteToFocus = null;
let notesSync = { notes: [], appearance: null };
const noteWindows = new Map();
const closingNoteIds = new Set();
let noteBoundsCache = null;
let noteBoundsWrites = Promise.resolve();
let noteDrag = null;
let notesSuppressed = false;
let workspaceReady = false;
const workspaceRequests = new Map();

const NOTES_WIDTH = 296;
const NOTES_MIN_HEIGHT = 120;
const NOTES_MAX_HEIGHT = 620;
const statePath = () => path.join(app.getPath('userData'), 'floating-agenda.json');
const windowBoundsPath = () => path.join(app.getPath('userData'), 'window-bounds.json');
const notesBoundsPath = () => path.join(app.getPath('userData'), 'notes-bounds.json');
const iconPath = () => path.join(__dirname, '..', 'build', 'icon.png');
const utilityWindows = createUtilityWindows(iconPath, persistWorkspaceItem, () => notesSync.notes.map((note, index) => ({
  id: note.id, label: note.text.trim().split('\n')[0].slice(0, 45) || (note.images?.length ? '图片便签 ' : '空白便签 ') + (index + 1),
})));

function deliverWorkspaceRequests() {
  if (!workspaceReady || !mainWindow || mainWindow.isDestroyed()) return;
  workspaceRequests.forEach(({ item }, requestId) => {
    mainWindow.webContents.send('workspace:add', { requestId, item });
  });
}

function persistWorkspaceItem(item) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timeout = setTimeout(() => finish(false), 12_000);
    function finish(saved) {
      clearTimeout(timeout);
      workspaceRequests.delete(requestId);
      if (saved) resolve();
      else reject(new Error('保存失败，请稍后重试'));
    }
    workspaceRequests.set(requestId, { item, finish });
    if (workspaceReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:add', { requestId, item });
    }
  });
}

function loadWindowBounds() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(windowBoundsPath(), 'utf8'));
    if (typeof saved.display === 'string' && /^-?\d+$/.test(saved.display)) calendarDisplayPreference = saved.display;
    const width = Math.round(Number(saved.width));
    const height = Math.round(Number(saved.height));
    const x = Math.round(Number(saved.x));
    const y = Math.round(Number(saved.y));
    if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function preferredCalendarDisplay() {
  return screen.getAllDisplays().find(display => String(display.id) === calendarDisplayPreference) ?? screen.getPrimaryDisplay();
}

function calendarDisplayStatus() {
  const primary = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  return {
    selected: calendarDisplayPreference,
    usingFallback: calendarDisplayPreference !== 'primary' && !displays.some(display => String(display.id) === calendarDisplayPreference),
    options: displays.map((display, index) => {
      const name = display.label || `显示器 ${index + 1}`;
      const { width, height } = display.bounds ?? display.workArea;
      const primaryLabel = display.id === primary.id ? '（当前主屏）' : '';
      return { value: String(display.id), label: `${name} · ${width} × ${height}${primaryLabel}` };
    }),
  };
}

function pushCalendarDisplays() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  const status = calendarDisplayStatus();
  mainWindow.webContents.send('calendar:displays-changed', status);
  utilityWindows.get('settings')?.webContents.send('calendar:displays-changed', status);
}

function recoverCalendarBounds(targetWorkArea) {
  const current = mainWindow.getBounds();
  const workArea = targetWorkArea ?? preferredCalendarDisplay().workArea;
  const next = placeCalendar(current, workArea, Boolean(targetWorkArea));
  if (next === current || (next.x === current.x && next.y === current.y
    && next.width === current.width && next.height === current.height)) return;
  adjustment = null;
  const minWidth = Math.min(MIN_CALENDAR_WIDTH, next.width);
  const minHeight = Math.min(MIN_CALENDAR_HEIGHT, next.height);
  const [oldMinWidth, oldMinHeight] = mainWindow.getMinimumSize();
  if (oldMinWidth !== minWidth || oldMinHeight !== minHeight) mainWindow.setMinimumSize(minWidth, minHeight);
  mainWindow.setBounds(next, false);
}

function onDisplayLayoutChanged() {
  clearTimeout(displayChangeTimer);
  displayChangeTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (calendarRequested && (mainWindow.isMinimized() || !mainWindow.isVisible())) {
      presentWindow(false);
    } else {
      recoverCalendarBounds();
      updateDesktopOrder();
    }
    pushCalendarDisplays();
  }, 200);
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getNormalBounds();
  const saved = JSON.stringify({ ...bounds, display: calendarDisplayPreference });
  const file = windowBoundsPath();
  windowBoundsWrites = windowBoundsWrites
    .then(async () => {
      await fs.writeFile(file + '.tmp', saved, 'utf8');
      await fs.rename(file + '.tmp', file);
    })
    .catch(error => console.warn('Unable to save calendar window position:', error));
  return windowBoundsWrites;
}

function updateDesktopOrder() {
  if (process.platform !== 'win32') return;

  const calendar = calendarRequested && mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  // Keep the calendar on the desktop. Sticky notes use the normal Windows stacking order.
  maintainDesktopOrder(calendar, latestSettings.desktopIconLayer === 'above', calendar ? [calendar] : []);
}

function focusWindow(win = mainWindow) {
  if (!win || win.isDestroyed()) return false;
  win.focus();
  win.webContents.focus();
  return win.isFocused();
}

function presentWindow(focus = true, targetWorkArea) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  calendarRequested = true;
  if (mainWindow.isMinimized()) mainWindow.restore();
  recoverCalendarBounds(targetWorkArea);
  if (focus) {
    mainWindow.show();
    focusWindow();
  } else {
    mainWindow.showInactive();
  }
  notesSuppressed = false;
  showOpenNoteWindows();
  updateDesktopOrder();
}

function showWindow() {
  presentWindow(true);
}

function showCalendarOnCurrentDisplay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  calendarDisplayPreference = display.id === screen.getPrimaryDisplay().id ? 'primary' : String(display.id);
  presentWindow(true, display.workArea);
  saveWindowBounds();
  pushCalendarDisplays();
}

function minimizeWindow() {
  adjustment = null;
  calendarRequested = false;
  mainWindow?.hide();
  notesSuppressed = true;
  noteToFocus = null;
  hideAllNoteWindows();
  updateDesktopOrder();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!calendarRequested || !mainWindow.isVisible() || mainWindow.isMinimized()
    || !calendarIsReachable(mainWindow.getBounds(), preferredCalendarDisplay().workArea)) showWindow();
  else minimizeWindow();
}

function sendMenuAction(action) {
  showWindow();
  if (!mainWindow) return;
  const deliver = () => mainWindow?.webContents.send('menu:action', action);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', deliver);
  else deliver();
}

function postMenuAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const deliver = () => mainWindow?.webContents.send('menu:action', action);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', deliver);
  else deliver();
}

function clampNoteBounds(bounds) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  });
  const area = display.workArea;
  const maxX = Math.max(area.x, area.x + area.width - bounds.width);
  const maxY = Math.max(area.y, area.y + area.height - bounds.height);
  return {
    x: Math.min(Math.max(Math.round(bounds.x), area.x), maxX),
    y: Math.min(Math.max(Math.round(bounds.y), area.y), maxY),
    width: bounds.width,
    height: bounds.height,
  };
}

function readNoteBoundsCache() {
  if (noteBoundsCache) return noteBoundsCache;
  noteBoundsCache = {};
  try {
    const saved = JSON.parse(fsSync.readFileSync(notesBoundsPath(), 'utf8'));
    const entries = saved && typeof saved.notes === 'object' && saved.notes ? saved.notes : {};
    Object.entries(entries).forEach(([id, value]) => {
      if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
      const height = Number.isFinite(value.height)
        ? Math.min(NOTES_MAX_HEIGHT, Math.max(NOTES_MIN_HEIGHT, Math.round(value.height)))
        : 220;
      noteBoundsCache[id] = { x: Math.round(value.x), y: Math.round(value.y), height, pinned: value.pinned === true };
    });
  } catch {
    // Missing or legacy bounds fall back to default placement.
  }
  return noteBoundsCache;
}

function persistNoteBounds() {
  if (!noteBoundsCache) return;
  const target = notesBoundsPath();
  const snapshot = JSON.stringify({ notes: noteBoundsCache });
  noteBoundsWrites = noteBoundsWrites.then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, snapshot, 'utf8');
  }).catch(error => console.warn('Unable to save note window preferences:', error));
}

function saveNoteBounds(id, win = noteWindows.get(id)) {
  if (!id || !win || win.isDestroyed()) return;
  const { x, y, height } = win.getNormalBounds();
  readNoteBoundsCache()[id] = { x: Math.round(x), y: Math.round(y), height: Math.round(height), pinned: win.isAlwaysOnTop() };
  persistNoteBounds();
}

function saveAllNoteBounds() {
  noteWindows.forEach((win, id) => saveNoteBounds(id, win));
}

function removeNoteBounds(id) {
  const cache = readNoteBoundsCache();
  if (!(id in cache)) return;
  delete cache[id];
  persistNoteBounds();
}

function defaultNoteBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const index = noteWindows.size % 8;
  let x = area.x + area.width - NOTES_WIDTH - 32;
  let y = area.y + 64;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    x = Math.max(area.x + 8, bounds.x + bounds.width - NOTES_WIDTH - 8);
    y = bounds.y + 40;
  }
  return clampNoteBounds({ x: x + index * 24, y: y + index * 24, width: NOTES_WIDTH, height: 220 });
}

function noteById(id) {
  if (typeof id !== 'string') return null;
  return notesSync.notes.find((note) => note && note.id === id) || null;
}

function pushNoteState(id) {
  const win = noteWindows.get(id);
  const note = noteById(id);
  if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading() || !note || !notesSync.appearance) return;
  const title = note.text.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 48) || (note.images?.length ? '图片便签' : '便签');
  if (win.getTitle() !== title) win.setTitle(title);
  win.webContents.send('note:state', { note, appearance: notesSync.appearance, pinned: win.isAlwaysOnTop() });
}

function pushAllNoteStates() {
  noteWindows.forEach((_win, id) => pushNoteState(id));
}

function showNoteWindow(id) {
  const win = noteWindows.get(id);
  const note = noteById(id);
  if (!win || win.isDestroyed() || !note || note.open !== true || notesSuppressed) return;
  if (win.webContents.isLoading()) return;
  if (noteToFocus === id) {
    noteToFocus = null;
    if (win.isMinimized()) win.restore();
    win.show();
    win.moveTop();
    focusWindow(win);
  } else if (!win.isVisible()) {
    win.showInactive();
  }
}

function showOpenNoteWindows() {
  noteWindows.forEach((_win, id) => showNoteWindow(id));
}

function hideNoteWindow(id) {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  saveNoteBounds(id, win);
  win.hide();
}

function hideAllNoteWindows() {
  noteWindows.forEach((_win, id) => hideNoteWindow(id));
}

function destroyNoteWindow(id) {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) {
    noteWindows.delete(id);
    return;
  }
  saveNoteBounds(id, win);
  closingNoteIds.add(id);
  try {
    win.destroy();
  } finally {
    closingNoteIds.delete(id);
  }
  noteWindows.delete(id);
}

function ensureNoteWindow(id) {
  const existing = noteWindows.get(id);
  if (existing && !existing.isDestroyed()) return existing;
  if (!noteById(id)) return null;
  const saved = readNoteBoundsCache()[id];
  const bounds = clampNoteBounds(saved
    ? { x: saved.x, y: saved.y, width: NOTES_WIDTH, height: saved.height }
    : defaultNoteBounds());
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    icon: iconPath(),
    backgroundColor: '#00000000',
    alwaysOnTop: saved?.pinned === true,
    skipTaskbar: !latestSettings.showNotesOnTaskbar,
    hasShadow: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  noteWindows.set(id, win);
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    url.searchParams.set('view', 'note');
    url.searchParams.set('id', id);
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'note', id } });
  }
  win.webContents.on('did-finish-load', () => {
    pushNoteState(id);
    showNoteWindow(id);
  });
  win.webContents.on('render-process-gone', () => {
    if (!isQuitting && !win.isDestroyed()) win.webContents.reload();
  });
  let saveMovedPosition;
  win.on('move', () => {
    clearTimeout(saveMovedPosition);
    saveMovedPosition = setTimeout(() => saveNoteBounds(id, win), 180);
  });
  win.on('minimize', sendNotePreviews);
  win.on('restore', sendNotePreviews);
  win.on('blur', () => {
    if (noteDrag?.id === id) endNoteDrag();
  });
  win.on('close', (event) => {
    if (isQuitting || closingNoteIds.has(id)) return;
    event.preventDefault();
    const note = noteById(id);
    if (note) note.open = false;
    destroyNoteWindow(id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:open-changed', id, false);
  });
  win.on('closed', () => {
    clearTimeout(saveMovedPosition);
    noteWindows.delete(id);
    if (noteDrag?.id === id) endNoteDrag();
  });
  return win;
}

function syncNoteWindows() {
  const knownIds = new Set(notesSync.notes.filter((note) => note && typeof note.id === 'string').map((note) => note.id));
  const openIds = new Set(notesSync.notes.filter((note) => note && note.open === true).map((note) => note.id));
  for (const id of [...noteWindows.keys()]) {
    if (!knownIds.has(id)) {
      destroyNoteWindow(id);
      removeNoteBounds(id);
      continue;
    }
    if (!openIds.has(id)) destroyNoteWindow(id);
  }
  openIds.forEach((id) => {
    const existed = noteWindows.has(id);
    const win = ensureNoteWindow(id);
    if (!win) return;
    pushNoteState(id);
    if (!existed) showNoteWindow(id);
  });
  pushAllNoteStates();
}

function startNoteDrag(id, grabX, grabY) {
  if (!Number.isFinite(grabX) || !Number.isFinite(grabY)) return;
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  endNoteDrag();
  noteDrag = {
    id,
    origin: win.getBounds(),
    grabX,
    grabY,
    height: null,
  };
}

function moveNote(win) {
  const pointer = screen.getCursorScreenPoint();
  const { origin, grabX, grabY } = noteDrag;
  const next = clampNoteBounds({ ...origin, x: pointer.x - grabX, y: pointer.y - grabY });
  const [x, y] = win.getPosition();
  if (x === next.x && y === next.y) return;
  const position = { x: next.x, y: next.y };
  if (process.platform === 'win32' && moveNoteWindow(win, screen.dipToScreenPoint(position))) return;
  win.setPosition(next.x, next.y);
}

function endNoteDrag() {
  const drag = noteDrag;
  if (!drag) return;
  noteDrag = null;
  if (drag.height != null) resizeNoteWindow(drag.id, drag.height);
  saveNoteBounds(drag.id);
}

function resizeNoteWindow(id, height) {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  if (noteDrag?.id === id) {
    noteDrag.height = height;
    return;
  }
  const numeric = Number(height);
  if (!Number.isFinite(numeric)) return;
  const current = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(current.x + current.width / 2),
    y: Math.round(current.y + current.height / 2),
  });
  const area = display.workArea;
  const maxHeight = Math.max(NOTES_MIN_HEIGHT, Math.min(NOTES_MAX_HEIGHT, area.height - 8));
  const nextHeight = Math.min(maxHeight, Math.max(NOTES_MIN_HEIGHT, Math.round(numeric)));
  let y = current.y;
  if (y + nextHeight > area.y + area.height - 4) y = Math.max(area.y + 4, area.y + area.height - nextHeight - 4);
  if (current.height !== nextHeight || current.y !== y) {
    win.setBounds({ x: current.x, y, width: current.width, height: nextHeight });
  }
}

function showEditContextMenu(win, params, extraActions = [], actionsFirst = false) {
  const editFlags = params.editFlags || {};
  const template = [];
  if (params.isEditable) {
    template.push(
      { label: '撤销', role: 'undo', enabled: editFlags.canUndo !== false },
      { label: '重做', role: 'redo', enabled: editFlags.canRedo !== false },
      { type: 'separator' },
      { label: '剪切', role: 'cut', enabled: editFlags.canCut !== false },
      { label: '复制', role: 'copy', enabled: editFlags.canCopy !== false },
      { label: '粘贴', role: 'paste', enabled: editFlags.canPaste !== false },
      { type: 'separator' },
      { label: '全选', role: 'selectAll', enabled: editFlags.canSelectAll !== false },
    );
  } else if (typeof params.selectionText === 'string' && params.selectionText.trim()) {
    template.push(
      { label: '复制', role: 'copy' },
      { type: 'separator' },
      { label: '全选', role: 'selectAll' },
    );
  } else if (!extraActions.length) {
    return;
  }
  if (extraActions.length) {
    if (!template.length) template.push(...extraActions);
    else if (actionsFirst) template.unshift(...extraActions, { type: 'separator' });
    else template.push({ type: 'separator' }, ...extraActions);
  }
  focusWindow(win);
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win, x: Math.round(params.x), y: Math.round(params.y) });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const shortcuts = [
    [latestSettings.showHideShortcut, toggleWindow],
    [latestSettings.quickCaptureShortcut, () => utilityWindows.open('quick')],
    [latestSettings.toggleContentShortcut, () => sendMenuAction('toggle-content')],
    [latestSettings.toggleNotesShortcut, revealNotes],
    [latestSettings.completeTaskShortcut, () => sendMenuAction('complete-selected')],
  ];
  const registered = new Set();
  shortcuts.forEach(([accelerator, callback]) => {
    if (!accelerator || typeof accelerator !== 'string' || registered.has(accelerator)) return;
    try {
      if (globalShortcut.register(accelerator, callback)) registered.add(accelerator);
      else console.warn('Global shortcut is unavailable:', accelerator);
    } catch (error) {
      console.warn('Invalid global shortcut:', accelerator, error);
    }
  });
}

async function applyIntegrationSettings() {
  const signature = JSON.stringify([
    latestSettings.autoStartEnabled,
    latestSettings.proxyEnabled,
    latestSettings.proxyServer,
    latestSettings.showHideShortcut,
    latestSettings.quickCaptureShortcut,
    latestSettings.toggleContentShortcut,
    latestSettings.toggleNotesShortcut,
    latestSettings.completeTaskShortcut,
    latestSettings.showNotesOnTaskbar,
  ]);
  if (signature === integrationSignature) return;
  integrationSignature = signature;

  if (process.platform === 'win32' && app.isPackaged) {
    const loginPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    app.setLoginItemSettings({ openAtLogin: Boolean(latestSettings.autoStartEnabled), path: loginPath });
  }
  try {
    const proxyServer = typeof latestSettings.proxyServer === 'string' ? latestSettings.proxyServer.trim() : '';
    await session.defaultSession.setProxy(latestSettings.proxyEnabled && proxyServer ? { proxyServer } : { proxyRules: 'direct://' });
  } catch (error) {
    console.warn('Unable to apply proxy settings:', error);
  }
  registerShortcuts();
  refreshNoteTaskbar();
}

function compareVersions(left, right) {
  const a = String(left).replace(/^v/, '').split('.').map(Number);
  const b = String(right).replace(/^v/, '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function checkForUpdates() {
  const feedUrl = process.env.FLOATING_AGENDA_UPDATE_URL;
  if (!feedUrl) return { status: 'unavailable', message: '当前便携版未配置更新发布源，因此没有执行网络检查。任务和便签仍只保存在本机。' };
  try {
    const url = new URL(feedUrl);
    if (url.protocol !== 'https:') throw new Error('Update feed must use HTTPS');
    const response = await net.fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Update feed returned ${response.status}`);
    const release = await response.json();
    if (!release || typeof release.version !== 'string') throw new Error('Invalid update feed');
    if (compareVersions(release.version, app.getVersion()) > 0) {
      return { status: 'available', message: `发现新版本 ${release.version}，当前版本 ${app.getVersion()}。`, url: typeof release.url === 'string' ? release.url : undefined };
    }
    return { status: 'current', message: `当前已是最新版本 ${app.getVersion()}。` };
  } catch (error) {
    return { status: 'unavailable', message: `暂时无法检查更新：${error.message}` };
  }
}

async function checkForUpdatesInBackground() {
  const result = await checkForUpdates();
  if (result.status === 'available' && Notification.isSupported()) {
    new Notification({ title: '浮屿桌面日历', body: result.message }).show();
  }
}

async function repairDesktopFromSettings() {
  const status = await repairDesktopInput();
  const messages = {
    enabled: 'Windows 桌面当前已启用鼠标输入。',
    restored: '已恢复 Windows 桌面的鼠标输入。',
    busy: '桌面有一个系统弹窗。请先关闭它，再尝试修复。',
    unavailable: '暂时无法修复桌面输入。',
  };
  return messages[status] ?? messages.unavailable;
}

function refreshNoteTaskbar() {
  const enabled = Boolean(latestSettings.showNotesOnTaskbar);
  const list = utilityWindows.get('notes');
  if (list) list.setSkipTaskbar(!enabled);
  noteWindows.forEach(win => { if (!win.isDestroyed()) win.setSkipTaskbar(!enabled); });
}

function revealNotes() {
  utilityWindows.open('notes', { skipTaskbar: !latestSettings.showNotesOnTaskbar });
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏日历', click: toggleWindow },
    { label: '将日历移到当前屏幕', click: showCalendarOnCurrentDisplay },
    { label: '新建日程', accelerator: 'Control+N', click: () => sendMenuAction('new-task') },
    { label: '快速记一条', click: () => utilityWindows.open('quick') },
    { label: '新建便签', click: () => postMenuAction('note:new') },
    { type: 'separator' },
    { label: '上一页', click: () => sendMenuAction('previous-month') },
    { label: '下一页', click: () => sendMenuAction('next-month') },
    { label: '回到今天', click: () => sendMenuAction('today') },
    {
      label: '显示日程',
      submenu: [
        { label: '全部', type: 'radio', checked: currentFilter === 'all', click: () => { currentFilter = 'all'; sendMenuAction('filter:all'); } },
        { label: '待办', type: 'radio', checked: currentFilter === 'pending', click: () => { currentFilter = 'pending'; sendMenuAction('filter:pending'); } },
        { label: '已完成', type: 'radio', checked: currentFilter === 'completed', click: () => { currentFilter = 'completed'; sendMenuAction('filter:completed'); } },
      ],
    },
    { type: 'separator' },
    { label: '自动编号', type: 'checkbox', checked: latestSettings.autoNumber, click: () => sendMenuAction('toggle:autoNumber') },
    { label: '显示周数', type: 'checkbox', checked: latestSettings.showWeekNumbers, click: () => sendMenuAction('toggle:showWeekNumbers') },
    { label: '显示农历与节日', type: 'checkbox', checked: latestSettings.showLunar, click: () => sendMenuAction('toggle:showLunar') },
    { label: '未完成任务自动顺延', type: 'checkbox', checked: latestSettings.rolloverEnabled, click: () => sendMenuAction('toggle:rolloverEnabled') },
    { label: '跟随 Windows 启动', type: 'checkbox', checked: latestSettings.autoStartEnabled, click: () => sendMenuAction('toggle:autoStartEnabled') },
    { label: '背景、透明度与更多设置…', click: () => sendMenuAction('open-settings') },
    { type: 'separator' },
    { label: '退出浮屿', click: quitApp },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const icon = nativeImage.createFromPath(iconPath());
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('浮屿桌面日历 · 左键显示/隐藏，右键设置');
  tray.on('click', toggleWindow);
  updateTrayMenu();
}

function createWindow() {
  const saved = loadWindowBounds();
  const { workArea } = preferredCalendarDisplay();
  const bounds = placeCalendar(saved, workArea);

  mainWindow = new BrowserWindow({
    minimizable: false,
    ...bounds,
    minWidth: Math.min(MIN_CALENDAR_WIDTH, bounds.width),
    minHeight: Math.min(MIN_CALENDAR_HEIGHT, bounds.height),
    transparent: true,
    frame: false,
    icon: iconPath(),
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.on('did-start-loading', () => { workspaceReady = false; });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => presentWindow(false));
  mainWindow.on('focus', updateDesktopOrder);
  mainWindow.on('blur', updateDesktopOrder);
  mainWindow.on('close', saveWindowBounds);
  mainWindow.webContents.on('context-menu', (_event, params) => showEditContextMenu(mainWindow, params));
  mainWindow.webContents.on('render-process-gone', () => {
    nutstore.cancelPendingPull();
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code) => {
    if (!isQuitting && code !== -3) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
      }, 1000);
    }
  });
  mainWindow.on('closed', () => {
    adjustment = null;
    calendarRequested = false;
    workspaceReady = false;
    mainWindow = null;
    if (!isQuitting) setTimeout(createWindow, 800);
  });
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

async function restoreSavedSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    if (saved.settings) latestSettings = { ...latestSettings, ...saved.settings };
  } catch {
    // A missing or invalid state file is handled by the renderer's normalizer.
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    nutstore.init({ userDataPath: app.getPath('userData') });
    await restoreSavedSettings();
    if (process.platform === 'win32') app.setAppUserModelId('com.floatingagenda.desktop');
    createWindow();
    createTray();
    screen.on('display-added', onDisplayLayoutChanged);
    screen.on('display-removed', onDisplayLayoutChanged);
    screen.on('display-metrics-changed', onDisplayLayoutChanged);
    desktopOrderTimer = setInterval(updateDesktopOrder, 250);
    await applyIntegrationSettings();
    if (latestSettings.autoCheckUpdates) void checkForUpdatesInBackground();
    setInterval(() => {
      if (latestSettings.autoCheckUpdates) void checkForUpdatesInBackground();
    }, 12 * 60 * 60 * 1000);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clearInterval(desktopOrderTimer);
    clearTimeout(displayChangeTimer);
    stopDesktopOrder();
    endNoteDrag();
    saveAllNoteBounds();
  });
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit();
  });
}

const themeFile = () => path.join(app.getPath('userData'), 'theme-image.jpg');
const themeDataUrl = (bytes) => 'data:image/jpeg;base64,' + bytes.toString('base64');

ipcMain.handle('theme:load', async (event) => {
  if (event.sender !== mainWindow?.webContents && event.sender !== utilityWindows.get('settings')?.webContents) return null;
  try {
    const bytes = await fs.readFile(themeFile());
    return bytes.length <= 5 * 1024 * 1024 ? themeDataUrl(bytes) : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('theme:save', async (event, bytes) => {
  if ((event.sender !== mainWindow?.webContents && event.sender !== utilityWindows.get('settings')?.webContents) || !(bytes instanceof Uint8Array)
      || bytes.length < 4 || bytes.length > 5 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) {
    throw new Error('无法保存主题图片');
  }
  const content = Buffer.from(bytes);
  const target = themeFile();
  const temp = target + '.tmp';
  await fs.writeFile(temp, content);
  await fs.rename(temp, target);
  return themeDataUrl(content);
});

ipcMain.handle('state:load', async () => {
  try {
    return JSON.parse(await fs.readFile(statePath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('state:save', async (_event, state) => {
  if (!state || !Array.isArray(state.tasks) || !state.settings) {
    throw new Error('Invalid application state');
  }
  latestSettings = { ...latestSettings, ...state.settings };
  updateTrayMenu();
  updateDesktopOrder();
  await persistState(state);
  await applyIntegrationSettings();
});

function persistState(state) {
  const target = statePath();
  const temp = `${target}.tmp`;
  const snapshot = JSON.stringify(state, null, 2);
  const write = stateWrites.then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temp, snapshot, 'utf8');
    await fs.rename(temp, target);
  });
  stateWrites = write.catch(() => {});
  return write;
}

ipcMain.handle('window:minimize', minimizeWindow);
ipcMain.handle('quick:open', event => {
  if (event.sender === mainWindow?.webContents) utilityWindows.open('quick');
});
ipcMain.handle('drawing:open', event => {
  if (event.sender === mainWindow?.webContents) utilityWindows.open('drawing');
});
ipcMain.on('workspace:ready', event => {
  if (event.sender !== mainWindow?.webContents) return;
  workspaceReady = true;
  deliverWorkspaceRequests();
});
ipcMain.on('workspace:saved', (event, requestId, saved) => {
  if (event.sender === mainWindow?.webContents) workspaceRequests.get(requestId)?.finish(saved === true);
});

ipcMain.on('notes:sync', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  notesSync = {
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    appearance: payload.appearance && typeof payload.appearance === 'object' ? payload.appearance : null,
  };
  syncNoteWindows();
  sendNotePreviews();
});

ipcMain.handle('note:ready', (event, id) => {
  const win = noteWindows.get(id);
  const note = noteById(id);
  if (!win || win.isDestroyed() || win.webContents !== event.sender || !note || !notesSync.appearance) return null;
  showNoteWindow(id);
  return { note, appearance: notesSync.appearance, pinned: win.isAlwaysOnTop() };
});

ipcMain.on('note:toggle-pin', (event, id) => {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed() || win.webContents !== event.sender) return;
  win.setAlwaysOnTop(!win.isAlwaysOnTop());
  saveNoteBounds(id, win);
  pushNoteState(id);
});

ipcMain.on('note:change', (event, message) => {
  if (!message || typeof message !== 'object') return;
  const id = typeof message.id === 'string' ? message.id : '';
  const note = noteById(id);
  if (!note || noteWindows.get(id)?.webContents !== event.sender) return;
  const patch = message.patch && typeof message.patch === 'object' ? message.patch : {};
  const next = { ...note };
  if (typeof patch.text === 'string') {
    next.text = patch.text;
    next.richText = typeof patch.richText === 'string' ? patch.richText : undefined;
  }
  if (typeof patch.completed === 'boolean') next.completed = patch.completed;
  const removedImageIds = Array.isArray(patch.removedImageIds)
    ? (note.images ?? []).filter(image => patch.removedImageIds.includes(image.id)).map(image => image.id) : [];
  if (removedImageIds.length) next.images = note.images.filter(image => !removedImageIds.includes(image.id));
  const index = notesSync.notes.indexOf(note);
  if (index >= 0) notesSync.notes[index] = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:patch', {
    id, patch: { text: next.text, richText: next.richText, completed: next.completed, removedImageIds },
  });
});

ipcMain.handle('note:insert-image', async (event, id, imageId) => {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed() || win.webContents !== event.sender || !noteById(id)
    || typeof imageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(imageId)) return false;
  const result = await dialog.showOpenDialog(win, {
    title: '插入便签图片', properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  const file = result.filePaths[0];
  if ((await fs.stat(file)).size > 24 * 1024 * 1024) throw new Error('图片太大');
  let picture = nativeImage.createFromBuffer(await fs.readFile(file));
  if (picture.isEmpty()) throw new Error('无法读取图片');
  const { width, height } = picture.getSize();
  if (Math.max(width, height) > 1050) picture = picture.resize(width >= height ? { width: 1050 } : { height: 1050 });
  const image = 'data:image/png;base64,' + picture.toPNG().toString('base64');
  await persistWorkspaceItem({ kind: 'image-note', id: imageId, image, targetNoteId: id });
  return true;
});

ipcMain.on('task:menu', (event, payload) => {
  if (event.sender !== mainWindow?.webContents || !payload) return;
  const { id, x, y, editing, completed, hasSelection } = payload;
  if (editing !== true || typeof id !== 'string' || !id || !Number.isFinite(x) || !Number.isFinite(y)) return;
  showEditContextMenu(mainWindow, { x, y, isEditable: editing === true, editFlags: { canCut: hasSelection, canCopy: hasSelection } }, [{
    label: completed ? '取消完成' : '完成当前任务',
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:menu-complete', { id, editing: editing === true, completed: !completed });
    },
  }], true);
});

ipcMain.on('note:format-menu', (event, payload) => {
  const { id, x, y, hasSelection } = payload ?? {};
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed() || win.webContents !== event.sender || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const send = (format) => {
    if (!win.isDestroyed()) win.webContents.send('note:format', format);
  };
  showEditContextMenu(win, { isEditable: true, x, y, editFlags: { canCut: hasSelection, canCopy: hasSelection } }, [
    { label: '插入勾选框', click: () => send({ type: 'checkbox' }) },
  ]);
});

ipcMain.on('note:close', (event, id) => {
  const note = noteById(id);
  const win = noteWindows.get(id);
  if (!note || !win || win.isDestroyed() || event.sender !== win.webContents) return;
  if (latestSettings.showNotesOnTaskbar) {
    saveNoteBounds(id, win);
    win.minimize();
    return;
  }
  note.open = false;
  destroyNoteWindow(id);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:open-changed', id, false);
});

ipcMain.on('note:delete', (_event, id) => {
  if (!noteById(id)) return;
  notesSync = { ...notesSync, notes: notesSync.notes.filter((note) => note.id !== id) };
  destroyNoteWindow(id);
  removeNoteBounds(id);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:deleted', id);
});

ipcMain.on('note:new', () => {
  notesSuppressed = false;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:create');
});

ipcMain.on('note:focus', (_event, id) => {
  if (typeof id !== 'string') return;
  noteToFocus = id;
  notesSuppressed = false;
  showNoteWindow(id);
});

function notePreviews() {
  return notesSync.notes.map(note => ({ id: note.id, text: note.text.slice(0, 600), image: note.images?.[0]?.src,
    createdAt: note.createdAt, open: note.open === true && !noteWindows.get(note.id)?.isMinimized() }));
}

function sendNotePreviews() {
  const list = utilityWindows.get('notes');
  if (list && !list.isDestroyed() && !list.webContents.isLoading() && !list.isMinimized()) list.webContents.send('note-list:changed', notePreviews());
}

ipcMain.on('note-list:open', event => {
  if (event.sender === mainWindow?.webContents || [...noteWindows.values()].some(win => win.webContents === event.sender)) revealNotes();
});
ipcMain.handle('note-list:get', event => event.sender === utilityWindows.get('notes')?.webContents ? notePreviews() : []);
ipcMain.on('note-list:choose', (event, id) => {
  if (event.sender !== utilityWindows.get('notes')?.webContents) return;
  const note = noteById(id);
  if (!note) return;
  note.open = true;
  notesSuppressed = false;
  noteToFocus = id;
  ensureNoteWindow(id);
  showNoteWindow(id);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:open-changed', id, true);
});

let settingsSnapshot = null;
let settingsRequestId = 0;
const pendingSettings = new Map();
ipcMain.on('settings:open', (event, category) => {
  if (event.sender !== mainWindow?.webContents) return;
  if (settingsSnapshot) settingsSnapshot = { ...settingsSnapshot, category };
  const existing = utilityWindows.get('settings');
  const win = utilityWindows.open('settings');
  if (!existing) win.once('closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:closed');
  });
});
ipcMain.on('settings:publish', (event, snapshot) => {
  if (event.sender !== mainWindow?.webContents) return;
  settingsSnapshot = snapshot;
  const win = utilityWindows.get('settings');
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('settings:changed', snapshot);
});
ipcMain.handle('settings:get', event => event.sender === utilityWindows.get('settings')?.webContents ? settingsSnapshot : null);
ipcMain.on('settings:close', event => {
  const win = utilityWindows.get('settings');
  if (event.sender === win?.webContents) win.close();
});
ipcMain.on('settings:command', (event, command) => {
  if (event.sender !== utilityWindows.get('settings')?.webContents || !mainWindow || mainWindow.isDestroyed() || command?.type === 'apply-sync') return;
  mainWindow.webContents.send('settings:command', command);
});
ipcMain.handle('settings:apply-sync', (event, result, expected) => {
  if (event.sender !== utilityWindows.get('settings')?.webContents || !mainWindow || mainWindow.isDestroyed()) throw new Error('无法访问日历');
  const id = ++settingsRequestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingSettings.delete(id); reject(new Error('同步超时')); }, 15000);
    pendingSettings.set(id, response => {
      clearTimeout(timer);
      if (response) resolve(response); else reject(new Error('同步未能完成'));
    });
    mainWindow.webContents.send('settings:command', { type: 'apply-sync', requestId: id, result, expected });
  });
});
ipcMain.on('settings:finish-sync', (event, id, result) => {
  if (event.sender !== mainWindow?.webContents) return;
  pendingSettings.get(id)?.(result);
  pendingSettings.delete(id);
});

ipcMain.on('note:drag-start', (event, id, x, y) => {
  if (noteWindows.get(id)?.webContents === event.sender) startNoteDrag(id, x, y);
});
ipcMain.on('note:drag-move', (event, id) => {
  const win = noteWindows.get(id);
  if (noteDrag?.id === id && win?.webContents === event.sender) moveNote(win);
});
ipcMain.on('note:drag-end', (event, id) => {
  if (noteDrag?.id === id && noteWindows.get(id)?.webContents === event.sender) endNoteDrag();
});
ipcMain.on('note:resize', (_event, id, height) => resizeNoteWindow(id, height));

ipcMain.handle('calendar:focus-input', (event) => {
  if (event.sender !== mainWindow?.webContents || !mainWindow.isVisible()) return;
  if (!mainWindow.isFocused() || !event.sender.isFocused()) focusWindow();
  updateDesktopOrder();
});

ipcMain.handle('calendar:get-displays', () => calendarDisplayStatus());
ipcMain.handle('calendar:set-display', async (event, preference) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return calendarDisplayStatus();
  if (preference !== 'primary' && !screen.getAllDisplays().some(display => String(display.id) === preference)) {
    return calendarDisplayStatus();
  }
  calendarDisplayPreference = preference;
  recoverCalendarBounds(preferredCalendarDisplay().workArea);
  updateDesktopOrder();
  await saveWindowBounds();
  return calendarDisplayStatus();
});

ipcMain.handle('window:adjust-mode', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  adjustment = null;
  updateDesktopOrder();
});

ipcMain.handle('desktop:repair-input', (event) => {
  if ((event.sender === mainWindow?.webContents || event.sender === utilityWindows.get('settings')?.webContents) && process.platform === 'win32') return repairDesktopFromSettings();
  return '暂时无法修复桌面输入。';
});

ipcMain.handle('window:adjust-start', (_event, mode, resizeEdges) => {
  if (!mainWindow || mainWindow.isDestroyed() || (mode !== 'move' && mode !== 'resize')) return;
  const cursor = screen.getCursorScreenPoint();
  adjustment = {
    mode,
    resizeEdges: typeof resizeEdges === 'string' && /^(?:[nsew]|[ns][ew])$/.test(resizeEdges) ? resizeEdges : 'se',
    cursor,
    lastCursor: cursor,
    bounds: mainWindow.getBounds(),
  };
});

ipcMain.handle('window:adjust-update', () => {
  if (!mainWindow || mainWindow.isDestroyed() || !adjustment) return;
  const cursor = screen.getCursorScreenPoint();
  if (cursor.x === adjustment.lastCursor.x && cursor.y === adjustment.lastCursor.y) return;
  adjustment.lastCursor = cursor;
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const dx = cursor.x - adjustment.cursor.x;
  const dy = cursor.y - adjustment.cursor.y;

  if (adjustment.mode === 'move') {
    const { bounds } = adjustment;
    const minX = workArea.x - bounds.width + 120;
    const maxX = workArea.x + workArea.width - 120;
    const minY = workArea.y;
    const maxY = workArea.y + workArea.height - 60;
    const x = Math.round(Math.min(maxX, Math.max(minX, bounds.x + dx)));
    const y = Math.round(Math.min(maxY, Math.max(minY, bounds.y + dy)));
    const current = mainWindow.getBounds();
    if (x !== current.x || y !== current.y || bounds.width !== current.width || bounds.height !== current.height) {
      mainWindow.setBounds({ x, y, width: bounds.width, height: bounds.height }, false);
    }
  } else {
    const { bounds, resizeEdges } = adjustment;
    const next = resizeCalendar(bounds, resizeEdges, dx, dy, workArea);
    const { x, y, width, height } = next;
    const current = mainWindow.getBounds();
    if (width !== current.width || height !== current.height || x !== current.x || y !== current.y) {
      mainWindow.setBounds(next, false);
    }
  }
});

ipcMain.handle('window:adjust-stop', () => {
  if (adjustment?.mode === 'move' && mainWindow && !mainWindow.isDestroyed()) {
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    if (display.id !== preferredCalendarDisplay().id) {
      calendarDisplayPreference = display.id === screen.getPrimaryDisplay().id ? 'primary' : String(display.id);
      pushCalendarDisplays();
    }
  }
  adjustment = null;
  saveWindowBounds();
});

ipcMain.handle('window:quit', quitApp);

ipcMain.handle('update:check', checkForUpdates);

ipcMain.handle('sync:status', () => nutstore.getStatus());
ipcMain.handle('sync:connect', (_event, payload) => nutstore.connect(payload && typeof payload === 'object' ? payload : {}));
ipcMain.handle('sync:disconnect', () => nutstore.disconnect());
ipcMain.handle('sync:auto', (_event, enabled) => nutstore.setAutoSync(enabled === true));
ipcMain.handle('sync:interval', (_event, intervalMinutes) => nutstore.setSyncInterval(intervalMinutes));
ipcMain.handle('sync:now', (_event, state, options) => nutstore.syncNow(state, options && typeof options === 'object' ? options : {}));

ipcMain.handle('sync:finish-pull', async (_event, id, state) => {
  if (!nutstore.hasPendingPull(id)) return nutstore.getStatus();
  try {
    if (state) await persistState(state);
    return nutstore.finishPull(id, Boolean(state));
  } catch (error) {
    nutstore.finishPull(id, false);
    throw error;
  }
});
