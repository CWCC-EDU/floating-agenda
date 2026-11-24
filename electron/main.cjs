const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, screen, session, Tray } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const nutstore = require('./nutstore.cjs');

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
  desktopIconLayer: 'below',
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
let helperBuffer = '';
let contextMenuOpen = false;
const foregroundWaiters = new Map();
const liftStates = new Map();
const desktopLayer = { raised: null, summon: false, timer: null, ticks: 0, styleThrough: null, styleBleed: null };
let notesSync = { notes: [], appearance: null };
const noteWindows = new Map();
const closingNoteIds = new Set();
let noteBoundsCache = null;
let noteDrag = null;
let notesSuppressed = false;

const NOTES_WIDTH = 296;
const NOTES_MIN_HEIGHT = 120;
const NOTES_MAX_HEIGHT = 620;
const statePath = () => path.join(app.getPath('userData'), 'floating-agenda.json');
const windowBoundsPath = () => path.join(app.getPath('userData'), 'window-bounds.json');
const notesBoundsPath = () => path.join(app.getPath('userData'), 'notes-bounds.json');
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

let attachLogged = false;
function logDesktop(message) {
  try {
    fs.appendFile(path.join(app.getPath('userData'), 'desktop.log'), `${new Date().toISOString()} ${message}\n`, 'utf8').catch(() => {});
  } catch {
    // logging is best-effort
  }
}

function attachToDesktop(forceShow = false, win = mainWindow) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const isMain = win === mainWindow;
  const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const placeAboveIcons = desktopLayer.raised !== false;
  const wantVisible = forceShow || win.isVisible();
  const command = `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class DesktopHost {
      [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
      [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string win);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr GetParent(IntPtr hWnd);
      [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
      public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
      [DllImport("user32.dll", SetLastError = true)]
      public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
      [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
      public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
      public static IntPtr FindDesktopDefView() {
        IntPtr progman = FindWindow("Progman", null);
        if (progman != IntPtr.Zero) {
          IntPtr direct = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
          if (direct != IntPtr.Zero) return direct;
        }
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
          IntPtr d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
          if (d != IntPtr.Zero) { found = d; return false; }
          return true;
        }, IntPtr.Zero);
        return found;
      }
    }';
    $cal = [IntPtr]::new([int64]'${handle}');
    $progman = [DesktopHost]::FindWindow('Progman', [NullString]::Value);
    if ($progman -eq [IntPtr]::Zero) { Write-Output 'NO_PROGMAN'; exit 0 }
    $defView = [DesktopHost]::FindDesktopDefView();
    $hostWnd = $progman;
    if ($defView -ne [IntPtr]::Zero) {
      $defParent = [DesktopHost]::GetParent($defView);
      if ($defParent -ne [IntPtr]::Zero) { $hostWnd = $defParent }
    }
    $currentParent = [DesktopHost]::GetParent($cal);
    $parentChanged = $currentParent -ne $hostWnd;
    if ($parentChanged) {
      if ($currentParent -ne [IntPtr]::Zero) { [DesktopHost]::SetParent($cal, [IntPtr]::Zero) | Out-Null }
      [DesktopHost]::SetParent($cal, $hostWnd) | Out-Null;
    }
    $style = [DesktopHost]::GetWindowLongPtr($cal, -16).ToInt64();
    $nextStyle = ($style -band (-bnot 0x80000000)) -bor 0x40000000;
    $styleChanged = $nextStyle -ne $style;
    if ($styleChanged) {
      [DesktopHost]::SetWindowLongPtr($cal, -16, [IntPtr]::new($nextStyle)) | Out-Null;
    }
    $placeAbove = $${placeAboveIcons ? 'true' : 'false'};
    $flags = 0x0013;
    if ($parentChanged -or $styleChanged) { $flags = $flags -bor 0x0020 }
    if ($placeAbove -or $defView -eq [IntPtr]::Zero) {
      [DesktopHost]::SetWindowPos($cal, [IntPtr]::new(0), 0, 0, 0, 0, $flags) | Out-Null;
    } else {
      [DesktopHost]::SetWindowPos($cal, $defView, 0, 0, 0, 0, $flags) | Out-Null;
    }
    if ($${wantVisible ? 'true' : 'false'}) {
      [DesktopHost]::ShowWindow($cal, 8) | Out-Null;
    }
    $parentBuf = [Text.StringBuilder]::new(256);
    $hostBuf = [Text.StringBuilder]::new(256);
    $nowParent = [DesktopHost]::GetParent($cal);
    if ($nowParent -ne [IntPtr]::Zero) { [DesktopHost]::GetClassName($nowParent, $parentBuf, 256) | Out-Null }
    [DesktopHost]::GetClassName($hostWnd, $hostBuf, 256) | Out-Null;
    $visible = [DesktopHost]::IsWindowVisible($cal);
    Write-Output ('ATTACHED:' + $visible + ':' + $parentBuf.ToString() + ':' + $hostBuf.ToString())
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
  child.on('error', (error) => console.error('Unable to attach window to desktop:', error));
  child.on('close', (code) => {
    const ok = code === 0 && stdout.includes('ATTACHED');
    if (isMain && !attachLogged) {
      attachLogged = true;
      logDesktop(`${ok ? 'attach' : 'attach-failed'} mode=${latestSettings.desktopIconLayer} wantVisible=${wantVisible} code=${code} out=${stdout.trim()} err=${stderr.trim()}`);
    }
    if (!ok) {
      console.error('Desktop attachment failed:', stderr || stdout || `exit ${code}`);
      if (isMain) putWindowAtDesktopBottom();
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
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public static IntPtr FindDesktopDefView() {
      IntPtr progman = FindWindow("Progman", null);
      if (progman != IntPtr.Zero) {
        IntPtr direct = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (direct != IntPtr.Zero) return direct;
      }
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate(IntPtr h, IntPtr l) {
        IntPtr d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (d != IntPtr.Zero) { found = d; return false; }
        return true;
      }, IntPtr.Zero);
      return found;
    }
  }';
  function Get-DesktopDefView {
    return [FocusGrant]::FindDesktopDefView()
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
      } elseif ($line.StartsWith('fg:')) {
        $target = [IntPtr]::new([int64]$line.Substring(3));
        $flag = if ([FocusGrant]::GetForegroundWindow() -eq $target) { '1' } else { '0' }
        Write-Output ('fg:' + $target.ToString() + ':' + $flag)
      } elseif ($line.StartsWith('detach:')) {
        $target = [IntPtr]::new([int64]$line.Substring(7));
        $parent = [FocusGrant]::GetParent($target);
        if ($parent -ne [IntPtr]::Zero) {
          $rect = New-Object FocusGrant+RECT;
          [FocusGrant]::GetWindowRect($target, [ref]$rect) | Out-Null;
          [FocusGrant]::SetParent($target, [IntPtr]::Zero) | Out-Null;
          $style = [FocusGrant]::GetWindowLongPtr($target, -16).ToInt64();
          $nextStyle = ($style -band (-bnot 0x40000000)) -bor 0x80000000;
          [FocusGrant]::SetWindowLongPtr($target, -16, [IntPtr]::new($nextStyle)) | Out-Null;
          [FocusGrant]::ShowWindow($target, 5) | Out-Null;
          [FocusGrant]::SetWindowPos($target, [IntPtr]::Zero, $rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top), 0x0030) | Out-Null;
        }
        $current = [FocusGrant]::GetCurrentThreadId();
        $foreground = [FocusGrant]::GetForegroundWindow();
        $fgPid = 0;
        $fgThread = 0;
        if ($foreground -ne [IntPtr]::Zero) { $fgThread = [FocusGrant]::GetWindowThreadProcessId($foreground, [ref]$fgPid) }
        $targetPid = 0;
        $targetThread = [FocusGrant]::GetWindowThreadProcessId($target, [ref]$targetPid);
        if ($fgThread -ne 0 -and $fgThread -ne $current) { [FocusGrant]::AttachThreadInput($current, $fgThread, $true) | Out-Null }
        if ($targetThread -ne $current -and $targetThread -ne $fgThread) { [FocusGrant]::AttachThreadInput($current, $targetThread, $true) | Out-Null }
        [FocusGrant]::SetForegroundWindow($target) | Out-Null;
        [FocusGrant]::BringWindowToTop($target) | Out-Null;
        [FocusGrant]::SetFocus($target) | Out-Null;
        if ($targetThread -ne $current -and $targetThread -ne $fgThread) { [FocusGrant]::AttachThreadInput($current, $targetThread, $false) | Out-Null }
        if ($fgThread -ne 0 -and $fgThread -ne $current) { [FocusGrant]::AttachThreadInput($current, $fgThread, $false) | Out-Null }
        Write-Output ('detached:' + ([FocusGrant]::GetForegroundWindow() -eq $target))
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
      } elseif ($line.StartsWith('hide:')) {
        $target = [IntPtr]::new([int64]$line.Substring(5));
        [FocusGrant]::ShowWindow($target, 0) | Out-Null
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
  child.stdout.on('data', (data) => {
    helperBuffer += data.toString();
    let index;
    while ((index = helperBuffer.indexOf('\n')) >= 0) {
      const line = helperBuffer.slice(0, index).trim();
      helperBuffer = helperBuffer.slice(index + 1);
      if (line.startsWith('fg:')) {
        const [, handle, flag] = line.split(':');
        const waiter = foregroundWaiters.get(handle);
        if (waiter) {
          foregroundWaiters.delete(handle);
          waiter(flag === '1');
        }
      } else if (line.startsWith('err:')) {
        logDesktop(`focus helper error ${line.slice(4)}`);
      }
    }
  });
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  child.on('error', (error) => console.error('Unable to start focus helper:', error));
  child.on('close', (code) => {
    if (code !== 0 && code !== null && stderr) console.error('Focus helper stopped:', stderr);
    if (focusHelper === child) focusHelper = null;
  });
  focusHelper = child;
  return child;
}

function grantOsFocus(win = mainWindow) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const helper = ensureFocusHelper();
  if (!helper || helper.stdin.destroyed) return;
  const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  try {
    helper.stdin.write(`focus:${handle}\n`);
  } catch {
    focusHelper = null;
  }
}

function sendDesktopCommand(command, win = mainWindow) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const helper = ensureFocusHelper();
  if (!helper || helper.stdin.destroyed) return;
  const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  try {
    helper.stdin.write(`${command}:${handle}\n`);
  } catch {
    focusHelper = null;
  }
}

function getLiftState(win) {
  if (!win) return null;
  let state = liftStates.get(win.id);
  if (!state) {
    state = { detached: false, at: 0, watch: null, probe: false };
    liftStates.set(win.id, state);
  }
  return state;
}

// IME composition needs a real foreground top-level window; a WS_CHILD parented to
// Progman never receives an input context, so lift the window out of the desktop
// while the user is typing and embed it again once another window takes focus.
function isWindowForeground(win) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) {
      resolve(true);
      return;
    }
    const helper = ensureFocusHelper();
    if (!helper || helper.stdin.destroyed) {
      resolve(true);
      return;
    }
    const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
    const previous = foregroundWaiters.get(handle);
    if (previous) {
      foregroundWaiters.delete(handle);
      previous(true);
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (foregroundWaiters.get(handle) === finish) foregroundWaiters.delete(handle);
      resolve(value);
    };
    foregroundWaiters.set(handle, finish);
    try {
      helper.stdin.write(`fg:${handle}\n`);
    } catch {
      focusHelper = null;
      finish(true);
      return;
    }
    setTimeout(() => finish(true), 900);
  });
}

function stopDetachedWatch(win) {
  const state = win ? getLiftState(win) : null;
  if (state?.watch) clearInterval(state.watch);
  if (state) state.watch = null;
}

function startDetachedWatch(win) {
  const state = getLiftState(win);
  if (!state || state.watch) return;
  state.watch = setInterval(async () => {
    if (!state.detached || !win || win.isDestroyed()) {
      stopDetachedWatch(win);
      return;
    }
    if (state.probe || contextMenuOpen || Date.now() - state.at < 1200) return;
    state.probe = true;
    const foreground = await isWindowForeground(win);
    state.probe = false;
    if (foreground || !state.detached || win.isDestroyed()) return;
    state.detached = false;
    stopDetachedWatch(win);
    logDesktop(`reattach after focus loss win=${win.id}`);
    attachToDesktop(win.isVisible(), win);
    if (win === mainWindow) updateDesktopLayer();
  }, 800);
}

function liftWindowForInput(win = mainWindow) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return false;
  const state = getLiftState(win);
  if (!state.detached) {
    state.detached = true;
    state.at = Date.now();
    const helper = ensureFocusHelper();
    const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
    if (helper && !helper.stdin.destroyed) {
      try {
        helper.stdin.write(`detach:${handle}\n`);
      } catch {
        focusHelper = null;
      }
    }
    logDesktop(`lift for input hwnd=${handle} win=${win.id}`);
  }
  startDetachedWatch(win);
  if (!win.isVisible()) win.show();
  win.focus();
  win.webContents.focus();
  grantOsFocus(win);
  return state.detached;
}

function desktopWindows() {
  const windows = [];
  if (mainWindow && !mainWindow.isDestroyed()) windows.push(mainWindow);
  noteWindows.forEach((win) => {
    if (win && !win.isDestroyed()) windows.push(win);
  });
  return windows;
}

function setDesktopLayer(raised) {
  if (desktopLayer.raised === raised) return;
  desktopLayer.raised = raised;
  desktopWindows().forEach((win) => {
    if (win.isVisible()) sendDesktopCommand(raised ? 'raise' : 'lower', win);
  });
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
  if (getLiftState(mainWindow)?.detached || desktopWindows().some((win) => getLiftState(win)?.detached)) {
    setDesktopStyles(false, false);
    return;
  }
  desktopLayer.ticks = (desktopLayer.ticks + 1) % 50;
  const force = desktopLayer.ticks === 0;
  const point = screen.getCursorScreenPoint();
  const containsPoint = (win) => {
    if (!win || win.isDestroyed() || !win.isVisible()) return false;
    const bounds = win.getBounds();
    return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
  };
  const inside = desktopWindows().some(containsPoint);
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

function presentWindow(focus = true) {
  if (!mainWindow) return;
  const state = getLiftState(mainWindow);
  state.detached = false;
  stopDetachedWatch(mainWindow);
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (focus) mainWindow.show();
  else mainWindow.showInactive();
  desktopLayer.summon = true;
  desktopLayer.raised = latestSettings.desktopIconLayer === 'above' ? false : latestSettings.desktopIconLayer === 'below' ? true : null;
  if (focus && !isQuitting) {
    mainWindow.focus();
    mainWindow.webContents.focus();
    grantOsFocus();
  }
  attachToDesktop(true);
  updateDesktopLayer();
  notesSuppressed = false;
  showOpenNoteWindows();
}

function showWindow() {
  presentWindow(true);
}

function minimizeWindow() {
  adjustment = null;
  desktopLayer.summon = false;
  const state = getLiftState(mainWindow);
  state.detached = false;
  stopDetachedWatch(mainWindow);
  setDesktopStyles(false, false);
  mainWindow?.setResizable(false);
  mainWindow?.hide();
  sendDesktopCommand('hide');
  notesSuppressed = true;
  hideAllNoteWindows();
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
      noteBoundsCache[id] = { x: Math.round(value.x), y: Math.round(value.y), height };
    });
  } catch {
    // Missing or legacy bounds fall back to default placement.
  }
  return noteBoundsCache;
}

function persistNoteBounds() {
  if (!noteBoundsCache) return;
  fs.mkdir(path.dirname(notesBoundsPath()), { recursive: true })
    .then(() => fs.writeFile(notesBoundsPath(), JSON.stringify({ notes: noteBoundsCache }), 'utf8'))
    .catch(() => {});
}

function saveNoteBounds(id, win = noteWindows.get(id)) {
  if (!id || !win || win.isDestroyed()) return;
  const { x, y, height } = win.getBounds();
  readNoteBoundsCache()[id] = { x: Math.round(x), y: Math.round(y), height: Math.round(height) };
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
  win.webContents.send('note:state', { note, appearance: notesSync.appearance });
}

function pushAllNoteStates() {
  noteWindows.forEach((_win, id) => pushNoteState(id));
}

function showNoteWindow(id) {
  const win = noteWindows.get(id);
  const note = noteById(id);
  if (!win || win.isDestroyed() || !note || note.open !== true || notesSuppressed) return;
  if (win.webContents.isLoading()) return;
  if (!win.isVisible()) win.showInactive();
  attachToDesktop(true, win);
}

function showOpenNoteWindows() {
  noteWindows.forEach((_win, id) => showNoteWindow(id));
}

function hideNoteWindow(id) {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  const state = getLiftState(win);
  state.detached = false;
  stopDetachedWatch(win);
  saveNoteBounds(id, win);
  if (win.isVisible()) {
    sendDesktopCommand('hide', win);
    win.hide();
  }
}

function hideAllNoteWindows() {
  noteWindows.forEach((_win, id) => hideNoteWindow(id));
}

function destroyNoteWindow(id) {
  if (noteDrag && noteDrag.id === id) endNoteDrag();
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) {
    noteWindows.delete(id);
    return;
  }
  saveNoteBounds(id, win);
  stopDetachedWatch(win);
  liftStates.delete(win.id);
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
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
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
  const windowId = win.id;
  noteWindows.set(id, win);
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    url.searchParams.set('view', 'note');
    url.searchParams.set('id', id);
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'note', id } });
  }
  win.webContents.on('context-menu', (_event, params) => showEditContextMenu(win, params));
  win.webContents.on('did-finish-load', () => {
    pushNoteState(id);
    showNoteWindow(id);
  });
  win.webContents.on('render-process-gone', () => {
    if (!isQuitting && !win.isDestroyed()) win.webContents.reload();
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
    noteWindows.delete(id);
    liftStates.delete(windowId);
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

function startNoteDrag(id) {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  if (noteDrag) clearInterval(noteDrag.timer);
  noteDrag = {
    id,
    cursor: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    startedAt: Date.now(),
    timer: setInterval(updateNoteDrag, 16),
  };
  sendDesktopCommand('raise', win);
}

function updateNoteDrag() {
  if (!noteDrag) return;
  const win = noteWindows.get(noteDrag.id);
  if (!win || win.isDestroyed() || Date.now() - noteDrag.startedAt > 20_000) {
    endNoteDrag();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const next = clampNoteBounds({
    x: noteDrag.bounds.x + cursor.x - noteDrag.cursor.x,
    y: noteDrag.bounds.y + cursor.y - noteDrag.cursor.y,
    width: noteDrag.bounds.width,
    height: noteDrag.bounds.height,
  });
  const current = win.getBounds();
  if (next.x !== current.x || next.y !== current.y) win.setBounds(next);
}

function endNoteDrag() {
  if (!noteDrag) return;
  clearInterval(noteDrag.timer);
  saveNoteBounds(noteDrag.id);
  noteDrag = null;
}

function resizeNoteWindow(id, height) {
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
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

function showEditContextMenu(win, params) {
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
  } else {
    return;
  }
  liftWindowForInput(win);
  const menu = Menu.buildFromTemplate(template);
  contextMenuOpen = true;
  menu.once('menu-will-close', () => {
    contextMenuOpen = false;
    const state = getLiftState(win);
    if (state.detached) startDetachedWatch(win);
  });
  menu.popup({ window: win, x: Math.round(params.x), y: Math.round(params.y) });
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
    { label: '新建便签', click: () => postMenuAction('note:new') },
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

  mainWindow.once('ready-to-show', () => presentWindow(false));
  mainWindow.on('minimize', minimizeWindow);
  mainWindow.on('close', saveWindowBounds);
  mainWindow.webContents.on('context-menu', (_event, params) => showEditContextMenu(mainWindow, params));
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
    nutstore.init({ userDataPath: app.getPath('userData') });
    await restoreSavedSettings();
    createWindow();
    createTray();
    setTimeout(ensureFocusHelper, 1500);
    startDesktopLayerWatch();
    await applyIntegrationSettings();
    if (latestSettings.autoCheckUpdates) void checkForUpdatesInBackground();
    setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !getLiftState(mainWindow)?.detached) attachToDesktop();
      noteWindows.forEach((win, id) => {
        const note = noteById(id);
        if (note?.open === true && win.isVisible() && !win.isDestroyed() && !getLiftState(win)?.detached) attachToDesktop(false, win);
      });
    }, 30_000);
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
    endNoteDrag();
    saveAllNoteBounds();
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

ipcMain.on('notes:sync', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  notesSync = {
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    appearance: payload.appearance && typeof payload.appearance === 'object' ? payload.appearance : null,
  };
  syncNoteWindows();
});

ipcMain.on('note:ready', (_event, id) => {
  pushNoteState(id);
  showNoteWindow(id);
});

ipcMain.on('note:change', (_event, message) => {
  if (!message || typeof message !== 'object') return;
  const id = typeof message.id === 'string' ? message.id : '';
  const note = noteById(id);
  if (!note) return;
  const patch = message.patch && typeof message.patch === 'object' ? message.patch : {};
  const next = { ...note };
  if (typeof patch.text === 'string') next.text = patch.text;
  if (typeof patch.completed === 'boolean') next.completed = patch.completed;
  const index = notesSync.notes.indexOf(note);
  if (index >= 0) notesSync.notes[index] = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('notes:patch', { id, patch: { text: next.text, completed: next.completed } });
});

ipcMain.on('note:close', (_event, id) => {
  const note = noteById(id);
  if (!note) return;
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
  const win = noteWindows.get(id);
  if (!win || win.isDestroyed()) return;
  notesSuppressed = false;
  showNoteWindow(id);
  if (win.isVisible()) liftWindowForInput(win);
});

ipcMain.on('note:drag-start', (_event, id) => startNoteDrag(id));
ipcMain.on('note:drag-move', (_event, id) => {
  if (noteDrag?.id === id) updateNoteDrag();
});
ipcMain.on('note:drag-end', (_event, id) => {
  if (noteDrag?.id === id) endNoteDrag();
});
ipcMain.on('note:resize', (_event, id, height) => resizeNoteWindow(id, height));

ipcMain.handle('desktop:interactive', (_event, active) => {
  interactionHold = active === true;
  updateDesktopLayer();
});

ipcMain.handle('desktop:begin-input', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return liftWindowForInput(win && !win.isDestroyed() ? win : mainWindow);
});

ipcMain.handle('window:focus', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const target = win && !win.isDestroyed() ? win : mainWindow;
  if (!target || target.isDestroyed()) return false;
  if (!target.isVisible()) target.show();
  target.focus();
  target.webContents.focus();
  grantOsFocus(target);
  return target.isFocused();
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

ipcMain.handle('sync:status', () => nutstore.getStatus());
ipcMain.handle('sync:connect', (_event, payload) => nutstore.connect(payload && typeof payload === 'object' ? payload : {}));
ipcMain.handle('sync:disconnect', () => nutstore.disconnect());
ipcMain.handle('sync:auto', (_event, enabled) => nutstore.setAutoSync(enabled === true));
ipcMain.handle('sync:now', (_event, state, options) => nutstore.syncNow(state, options && typeof options === 'object' ? options : {}));
