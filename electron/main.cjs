const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, screen, session, Tray } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

let mainWindow = null;
let tray = null;
let currentFilter = 'all';
let isQuitting = false;
let latestSettings = {
  autoNumber: true,
  showWeekNumbers: true,
  showLunar: true,
  rolloverEnabled: true,
  autoStartEnabled: false,
  autoCheckUpdates: false,
  desktopIconLayer: 'auto',
  proxyEnabled: false,
  proxyServer: '',
  showHideShortcut: 'Control+Shift+Space',
  toggleContentShortcut: '',
  toggleNotesShortcut: '',
  completeTaskShortcut: '',
};
let adjustment = null;
let interactionHold = false;
let integrationSignature = '';
let focusHelper = null;
const desktopLayer = { raised: null, summon: false, timer: null, ticks: 0, styleThrough: null, styleBleed: null };

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
  const placeAboveIcons = desktopLayer.raised !== false;
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
      public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
      [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    }';
    $cal = [IntPtr]::new([int64]'${handle}');
    $progman = [DesktopHost]::FindWindow('Progman', [NullString]::Value);
    if ($progman -eq [IntPtr]::Zero) { Write-Output 'NO_PROGMAN'; exit 0 }
    $child = [DesktopHost]::GetWindow($progman, 5);
    $hostWnd = $progman;
    $defView = [IntPtr]::Zero;
    while ($child -ne [IntPtr]::Zero) {
      $buf = [Text.StringBuilder]::new(256);
      [DesktopHost]::GetClassName($child, $buf, 256) | Out-Null;
      if ($buf.ToString() -eq 'SHELLDLL_DefView') {
        $defView = $child;
        $parentOfDefView = [DesktopHost]::GetParent($child);
        if ($parentOfDefView -ne [IntPtr]::Zero) { $hostWnd = $parentOfDefView }
        break
      }
      $child = [DesktopHost]::GetWindow($child, 2);
    }
    $style = [DesktopHost]::GetWindowLongPtr($cal, -16).ToInt64();
    $style = ($style -band (-bnot 0x80000000)) -bor 0x40000000;
    [DesktopHost]::SetWindowLongPtr($cal, -16, [IntPtr]::new($style)) | Out-Null;
    if ([DesktopHost]::GetParent($cal) -ne $hostWnd) {
      [DesktopHost]::SetParent($cal, $hostWnd) | Out-Null;
    }
    $placeAbove = $${placeAboveIcons ? 'true' : 'false'};
    if ($placeAbove -or $defView -eq [IntPtr]::Zero) {
      [DesktopHost]::SetWindowPos($cal, [IntPtr]::new(0), 0, 0, 0, 0, 0x0013) | Out-Null;
    } else {
      [DesktopHost]::SetWindowPos($cal, $defView, 0, 0, 0, 0, 0x0013) | Out-Null;
    }
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
    if (code !== 0 || !stdout.includes('ATTACHED')) {
      console.error('Desktop attachment failed:', stderr || stdout || `exit ${code}`);
      putWindowAtDesktopBottom();
    }
  });
}

const FOCUS_HELPER_SCRIPT = `
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class FocusGrant {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool doAttach);
    [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string win);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr lprcUpdate, IntPtr hrgnUpdate, uint flags);
  }';
  function Get-DesktopDefView {
    $progman = [FocusGrant]::FindWindow('Progman', [NullString]::Value);
    if ($progman -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    $child = [FocusGrant]::GetWindow($progman, 5);
    while ($child -ne [IntPtr]::Zero) {
      $buf = [Text.StringBuilder]::new(256);
      [FocusGrant]::GetClassName($child, $buf, 256) | Out-Null;
      if ($buf.ToString() -eq 'SHELLDLL_DefView') { return $child }
      $child = [FocusGrant]::GetWindow($child, 2);
    }
    return [IntPtr]::Zero
  }
  function Get-DesktopIconWindows {
    $defView = Get-DesktopDefView;
    if ($defView -eq [IntPtr]::Zero) { return @() }
    $listView = [FocusGrant]::FindWindowEx($defView, [IntPtr]::Zero, 'SysListView32', [NullString]::Value);
    return @($defView, $listView) | Where-Object { $_ -ne [IntPtr]::Zero }
  }
  function Set-DesktopIconStyles([bool]$wantThrough, [bool]$wantBleed) {
    foreach ($h in (Get-DesktopIconWindows)) {
      $exStyle = [FocusGrant]::GetWindowLongPtr($h, -20).ToInt64();
      $nextEx = if ($wantThrough) { $exStyle -bor 0x20 } else { $exStyle -band (-bnot 0x20) };
      if ($nextEx -ne $exStyle) {
        [FocusGrant]::SetWindowLongPtr($h, -20, [IntPtr]$nextEx) | Out-Null;
        [FocusGrant]::RedrawWindow($h, [IntPtr]::Zero, [IntPtr]::Zero, 0x185) | Out-Null;
      }
      $style = [FocusGrant]::GetWindowLongPtr($h, -16).ToInt64();
      $nextStyle = if ($wantBleed) { $style -band (-bnot 0x04000000) } else { $style -bor 0x04000000 };
      if ($nextStyle -ne $style) {
        [FocusGrant]::SetWindowLongPtr($h, -16, [IntPtr]$nextStyle) | Out-Null;
        [FocusGrant]::RedrawWindow($h, [IntPtr]::Zero, [IntPtr]::Zero, 0x185) | Out-Null;
      }
    }
  }
  while ($true) {
    $line = [Console]::In.ReadLine();
    if ($null -eq $line) { break }
    $line = $line.Trim();
    if ($line -eq 'quit') { break }
    try {
      if ($line.StartsWith('focus:')) {
        $target = [IntPtr]::new([int64]$line.Substring(6));
        $current = [FocusGrant]::GetCurrentThreadId();
        $foreground = [FocusGrant]::GetForegroundWindow();
        $fgPid = 0;
        $fgThread = 0;
        if ($foreground -ne [IntPtr]::Zero) { $fgThread = [FocusGrant]::GetWindowThreadProcessId($foreground, [ref]$fgPid) }
        $targetPid = 0;
        $targetThread = [FocusGrant]::GetWindowThreadProcessId($target, [ref]$targetPid);
        if ($fgThread -ne 0 -and $fgThread -ne $current) { [FocusGrant]::AttachThreadInput($current, $fgThread, $true) | Out-Null }
        if ($targetThread -ne $current -and $targetThread -ne $fgThread) { [FocusGrant]::AttachThreadInput($current, $targetThread, $true) | Out-Null }
        [FocusGrant]::SetFocus($target) | Out-Null
        if ($targetThread -ne $current -and $targetThread -ne $fgThread) { [FocusGrant]::AttachThreadInput($current, $targetThread, $false) | Out-Null }
        if ($fgThread -ne 0 -and $fgThread -ne $current) { [FocusGrant]::AttachThreadInput($current, $fgThread, $false) | Out-Null }
        Write-Output 'ok'
      } elseif ($line.StartsWith('raise:')) {
        $target = [IntPtr]::new([int64]$line.Substring(6));
        [FocusGrant]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
        Write-Output 'ok'
      } elseif ($line.StartsWith('lower:')) {
        $target = [IntPtr]::new([int64]$line.Substring(6));
        $defView = Get-DesktopDefView;
        if ($defView -eq [IntPtr]::Zero) { Write-Output 'nodefview' } else {
          [FocusGrant]::SetWindowPos($target, $defView, 0, 0, 0, 0, 0x0013) | Out-Null
          Write-Output 'ok'
        }
      } elseif ($line.StartsWith('styles:')) {
        $parts = $line.Substring(7).Split(':');
        Set-DesktopIconStyles ($parts[0] -eq '1') ($parts.Length -gt 1 -and $parts[1] -eq '1');
        Write-Output 'ok'
      }
    } catch {
      Write-Output ('err:' + $_.Exception.Message)
    }
  }
  try { Set-DesktopIconStyles $false $false } catch {}
`;

function ensureFocusHelper() {
  if (process.platform !== 'win32') return null;
  if (focusHelper && focusHelper.exitCode === null && !focusHelper.killed) return focusHelper;
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    FOCUS_HELPER_SCRIPT,
  ], { windowsHide: true });
  let stderr = '';
  child.stdin.on('error', () => {});
  child.stdout.on('data', () => {});
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  child.on('error', (error) => console.error('Unable to start focus helper:', error));
  child.on('close', (code) => {
    if (code !== 0 && code !== null && stderr) console.error('Focus helper stopped:', stderr);
    if (focusHelper === child) focusHelper = null;
  });
  focusHelper = child;
  return child;
}

function grantOsFocus() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const helper = ensureFocusHelper();
  if (!helper || helper.stdin.destroyed) return;
  const handle = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
  try {
    helper.stdin.write(`focus:${handle}\n`);
  } catch {
    focusHelper = null;
  }
}

function sendDesktopCommand(command) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const helper = ensureFocusHelper();
  if (!helper || helper.stdin.destroyed) return;
  const handle = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
  try {
    helper.stdin.write(`${command}:${handle}\n`);
  } catch {
    focusHelper = null;
  }
}

function setDesktopLayer(raised) {
  if (desktopLayer.raised === raised) return;
  desktopLayer.raised = raised;
  sendDesktopCommand(raised ? 'raise' : 'lower');
}

function setDesktopStyles(through, bleed, force = false) {
  if (!force && desktopLayer.styleThrough === through && desktopLayer.styleBleed === bleed) return;
  desktopLayer.styleThrough = through;
  desktopLayer.styleBleed = bleed;
  if (process.platform !== 'win32') return;
  const helper = ensureFocusHelper();
  if (!helper || helper.stdin.destroyed) {
    desktopLayer.styleThrough = null;
    desktopLayer.styleBleed = null;
    return;
  }
  try {
    helper.stdin.write(`styles:${through ? 1 : 0}:${bleed ? 1 : 0}\n`);
  } catch {
    focusHelper = null;
    desktopLayer.styleThrough = null;
    desktopLayer.styleBleed = null;
  }
}

function updateDesktopLayer() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    setDesktopStyles(false, false);
    return;
  }
  desktopLayer.ticks = (desktopLayer.ticks + 1) % 50;
  const force = desktopLayer.ticks === 0;
  const point = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
  if (latestSettings.desktopIconLayer === 'above') {
    desktopLayer.summon = false;
    setDesktopLayer(interactionHold);
    setDesktopStyles(!interactionHold && inside, false, force);
    return;
  }
  if (latestSettings.desktopIconLayer === 'below') {
    setDesktopLayer(true);
    setDesktopStyles(false, true, force);
    return;
  }
  setDesktopStyles(false, false, force);
  if (inside) desktopLayer.summon = false;
  setDesktopLayer(Boolean(adjustment) || desktopLayer.summon || inside);
}

function startDesktopLayerWatch() {
  if (process.platform !== 'win32' || desktopLayer.timer) return;
  desktopLayer.timer = setInterval(updateDesktopLayer, 60);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  desktopLayer.summon = true;
  desktopLayer.raised = latestSettings.desktopIconLayer === 'above' ? false : latestSettings.desktopIconLayer === 'below' ? true : null;
  if (!isQuitting) {
    mainWindow.focus();
    mainWindow.webContents.focus();
    grantOsFocus();
  }
  attachToDesktop();
  updateDesktopLayer();
}

function minimizeWindow() {
  adjustment = null;
  desktopLayer.summon = false;
  setDesktopStyles(false, false);
  mainWindow?.setResizable(false);
  mainWindow?.hide();
}

function toggleWindow() {
  if (!mainWindow) return;
  const focused = mainWindow.isFocused() || mainWindow.webContents.isFocused();
  if (mainWindow.isMinimized() || !mainWindow.isVisible() || !focused) showWindow();
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
  mainWindow.on('minimize', minimizeWindow);
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
    desktopLayer.raised = null;
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
    await restoreSavedSettings();
    createWindow();
    createTray();
    setTimeout(ensureFocusHelper, 1500);
    startDesktopLayerWatch();
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

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (desktopLayer.timer) clearInterval(desktopLayer.timer);
    desktopLayer.timer = null;
    if (focusHelper) {
      try {
        focusHelper.stdin.write('styles:0:0\n');
        focusHelper.stdin.end();
      } catch {
        focusHelper.kill();
      }
      focusHelper = null;
    }
  });
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

ipcMain.handle('desktop:interactive', (_event, active) => {
  interactionHold = active === true;
  updateDesktopLayer();
});

ipcMain.handle('window:focus', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
  grantOsFocus();
  return mainWindow.isFocused();
});

ipcMain.handle('window:adjust-mode', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  adjustment = null;
  mainWindow.setResizable(enabled === true);
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
});

ipcMain.handle('window:quit', quitApp);

ipcMain.handle('update:check', checkForUpdates);
