const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, screen, session, Tray } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

let mainWindow = null;
let tray = null;
let currentFilter = 'all';
let isQuitting = false;
let desktopAttached = false;
let latestSettings = {
  autoNumber: true,
  showWeekNumbers: true,
  showLunar: true,
  rolloverEnabled: true,
  autoStartEnabled: false,
  autoCheckUpdates: false,
  proxyEnabled: false,
  proxyServer: '',
  showHideShortcut: 'Control+Shift+Space',
  toggleContentShortcut: '',
  toggleNotesShortcut: '',
  completeTaskShortcut: '',
};
let adjustment = null;
let integrationSignature = '';

const statePath = () => path.join(app.getPath('userData'), 'floating-agenda.json');
const windowBoundsPath = () => path.join(app.getPath('userData'), 'window-bounds.json');
const iconPath = () => path.join(__dirname, '..', 'build', 'icon.png');

function loadWindowBounds(workArea) {
  try {
    const saved = JSON.parse(fsSync.readFileSync(windowBoundsPath(), 'utf8'));
    const width = Math.round(Number(saved.width));
    const height = Math.round(Number(saved.height));
    const x = Math.round(Number(saved.x));
    const y = Math.round(Number(saved.y));
    if (![width, height, x, y].every(Number.isFinite) || width < 760 || height < 520) return null;
    const margin = 60;
    const clampedX = Math.min(Math.max(x, workArea.x + margin - width + 120), workArea.x + workArea.width - 120);
    const clampedY = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - margin);
    return { x: clampedX, y: clampedY, width, height };
  } catch {
    return null;
  }
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { x, y, width, height } = mainWindow.getBounds();
  fs.writeFile(windowBoundsPath(), JSON.stringify({ x, y, width, height }), 'utf8').catch(() => {});
}

function putWindowAtDesktopBottom() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const handle = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const command = `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DesktopWindow {
      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    }';
    [DesktopWindow]::SetWindowPos([IntPtr]::new([int64]'${handle}'), [IntPtr]::new(1), 0, 0, 0, 0, 0x0013) | Out-Null
  `;
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  child.on('error', (error) => console.error('Unable to position desktop calendar:', error));
  child.on('close', (code) => {
    if (code !== 0) console.error('Desktop calendar positioning failed:', stderr || `exit ${code}`);
  });
}

function attachToDesktop() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const handle = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const command = `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class DesktopHost {
      [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr GetParent(IntPtr hWnd);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
      [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool IsWindowVisible(IntPtr hWnd);
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    }';
    $found = [System.Collections.Generic.List[object]]::new();
    $defViewClass = 'SHELLDLL_DefView';
    $cal = [IntPtr]::new([int64]'${handle}');
    $progman = [DesktopHost]::FindWindow('Progman', [NullString]::Value);
    if ($progman -ne [IntPtr]::Zero) {
      $probe = { param($w, $l) $buf = [Text.StringBuilder]::new(256); [DesktopHost]::GetClassName($w, $buf, 256) | Out-Null; if ($buf.ToString() -eq $defViewClass) { $found.Add($w) }; return $true }.GetNewClosure();
      [DesktopHost]::EnumChildWindows($progman, $probe, [IntPtr]::Zero) | Out-Null;
    }
    if ($found.Count -eq 0) {
      $workerProbe = { param($w, $l) $buf = [Text.StringBuilder]::new(256); [DesktopHost]::GetClassName($w, $buf, 256) | Out-Null; if ($buf.ToString() -eq 'WorkerW') { $found.Add($w) }; return $true }.GetNewClosure();
      [DesktopHost]::EnumWindows($workerProbe, [IntPtr]::Zero) | Out-Null;
      $defFound = $false;
      foreach ($w in $found) {
        $probe2 = { param($ww, $ll) $buf = [Text.StringBuilder]::new(256); [DesktopHost]::GetClassName($ww, $buf, 256) | Out-Null; if ($buf.ToString() -eq $defViewClass) { $found.Add($ww) }; return $true }.GetNewClosure();
        [DesktopHost]::EnumChildWindows($w, $probe2, [IntPtr]::Zero) | Out-Null;
        if ($found.Count -gt 0) { $defFound = $true; break }
      }
      if (-not $defFound) { $found.Clear() }
    }
    $def = [IntPtr]::Zero;
    if ($found.Count -gt 0) { $def = [IntPtr]$found[$found.Count - 1] }
    if ($def -eq [IntPtr]::Zero) { Write-Output 'NO_DEFVIEW'; exit 0 }
    $hostWnd = [DesktopHost]::GetParent($def);
    if ($hostWnd -eq [IntPtr]::Zero) { $hostWnd = $progman }
    if ([DesktopHost]::GetParent($cal) -ne $hostWnd) {
      [DesktopHost]::SetParent($cal, $hostWnd) | Out-Null;
    }
    [DesktopHost]::SetWindowPos($cal, $def, 0, 0, 0, 0, 0x0013) | Out-Null;
    Write-Output 'ATTACHED'
  `;
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  child.on('error', (error) => console.error('Unable to attach calendar to desktop:', error));
  child.on('close', (code) => {
    if (code === 0 && stdout.includes('ATTACHED')) {
      desktopAttached = true;
    } else {
      if (code !== 0) console.error('Desktop attachment failed:', stderr || `exit ${code}`);
      if (!desktopAttached) putWindowAtDesktopBottom();
    }
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.showInactive();
  attachToDesktop();
}

function minimizeWindow() {
  adjustment = null;
  mainWindow?.setResizable(false);
  mainWindow?.hide();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized() || !mainWindow.isVisible()) showWindow();
  else minimizeWindow();
}

function sendMenuAction(action) {
  showWindow();
  if (!mainWindow) return;
  const deliver = () => mainWindow?.webContents.send('menu:action', action);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', deliver);
  else deliver();
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const shortcuts = [
    [latestSettings.showHideShortcut, toggleWindow],
    [latestSettings.toggleContentShortcut, () => sendMenuAction('toggle-content')],
    [latestSettings.toggleNotesShortcut, () => sendMenuAction('toggle-notes')],
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
    latestSettings.toggleContentShortcut,
    latestSettings.toggleNotesShortcut,
    latestSettings.completeTaskShortcut,
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

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏日历', click: toggleWindow },
    { label: '新建日程', accelerator: 'Control+N', click: () => sendMenuAction('new-task') },
    { type: 'separator' },
    { label: '上一月', click: () => sendMenuAction('previous-month') },
    { label: '下一月', click: () => sendMenuAction('next-month') },
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
  const workArea = screen.getPrimaryDisplay().workArea;
  const savedBounds = loadWindowBounds(workArea);
  const width = savedBounds ? savedBounds.width : Math.min(1180, workArea.width - 64);
  const height = savedBounds ? savedBounds.height : Math.min(760, workArea.height - 64);

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 760,
    minHeight: 520,
    x: savedBounds ? savedBounds.x : workArea.x + Math.floor((workArea.width - width) / 2),
    y: savedBounds ? savedBounds.y : workArea.y + Math.floor((workArea.height - height) / 2),
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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', attachToDesktop);
  mainWindow.on('show', attachToDesktop);
  mainWindow.on('restore', attachToDesktop);
  mainWindow.on('close', saveWindowBounds);
  mainWindow.webContents.on('render-process-gone', () => {
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
    mainWindow = null;
    desktopAttached = false;
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
    await restoreSavedSettings();
    createWindow();
    createTray();
    await applyIntegrationSettings();
    if (latestSettings.autoCheckUpdates) void checkForUpdatesInBackground();
    setInterval(attachToDesktop, 30_000);
    setInterval(() => {
      if (latestSettings.autoCheckUpdates) void checkForUpdatesInBackground();
    }, 12 * 60 * 60 * 1000);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit();
  });
}

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
  await applyIntegrationSettings();
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8');
});

ipcMain.handle('window:minimize', minimizeWindow);

ipcMain.handle('window:adjust-mode', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  adjustment = null;
  mainWindow.setResizable(enabled === true);
  if (!enabled) attachToDesktop();
});

ipcMain.handle('window:adjust-start', (_event, mode, resizeEdges) => {
  if (!mainWindow || mainWindow.isDestroyed() || (mode !== 'move' && mode !== 'resize')) return;
  mainWindow.setResizable(true);
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
    const [minWidth, minHeight] = mainWindow.getMinimumSize();
    const { bounds, resizeEdges } = adjustment;
    const width = Math.round(Math.max(minWidth, bounds.width + (resizeEdges.includes('e') ? dx : resizeEdges.includes('w') ? -dx : 0)));
    const height = Math.round(Math.max(minHeight, bounds.height + (resizeEdges.includes('s') ? dy : resizeEdges.includes('n') ? -dy : 0)));
    const x = Math.round(resizeEdges.includes('w') ? bounds.x + bounds.width - width : bounds.x);
    const y = Math.round(resizeEdges.includes('n') ? bounds.y + bounds.height - height : bounds.y);
    const current = mainWindow.getBounds();
    if (width !== current.width || height !== current.height || x !== current.x || y !== current.y) {
      mainWindow.setBounds({ x, y, width, height }, false);
    }
  }
});

ipcMain.handle('window:adjust-stop', () => {
  adjustment = null;
  saveWindowBounds();
  attachToDesktop();
});

ipcMain.handle('window:quit', quitApp);

ipcMain.handle('update:check', checkForUpdates);
