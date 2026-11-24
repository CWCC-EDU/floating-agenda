const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

let helper = null;
let helperScript;
let canRetryAt = 0;
let repairRequest;

function nativeHandle(win) {
  return win.getNativeWindowHandle().readBigUInt64LE(0).toString();
}

function maintainDesktopOrder(calendar, iconsAbove, windows) {
  if ((!calendar && windows.length === 0 && !helper) || Date.now() < canRetryAt) return;
  if (!helper) {
    if (!helperScript) {
      const source = fs.readFileSync(path.join(__dirname, 'desktop-order.ps1'));
      const compressed = gzipSync(source).toString('base64');
      helperScript = `
        $bytes = [Convert]::FromBase64String('${compressed}')
        $buffer = [IO.MemoryStream]::new($bytes)
        $gzip = [IO.Compression.GZipStream]::new($buffer, [IO.Compression.CompressionMode]::Decompress)
        $reader = [IO.StreamReader]::new($gzip)
        & ([ScriptBlock]::Create($reader.ReadToEnd()))
      `;
    }
    const encoded = Buffer.from(helperScript, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let reply = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      reply += chunk;
      const lines = reply.split('\n');
      reply = lines.pop();
      for (const line of lines) {
        if (line.startsWith('repair:')) repairRequest?.finish(line.slice(7).trim());
      }
    });
    child.stderr.on('data', (data) => console.error('Desktop order:', data.toString().trim()));
    child.stdin.on('error', () => {});
    child.on('error', (error) => console.error('Unable to start desktop order helper:', error));
    child.on('close', () => {
      if (helper !== child) return;
      helper = null;
      repairRequest?.finish('unavailable');
      canRetryAt = Date.now() + 5000;
    });
    helper = child;
  }

  if (helper.stdin.destroyed || helper.stdin.writableNeedDrain) return;
  const handles = [calendar ? nativeHandle(calendar) : '0', iconsAbove ? '1' : '0', ...windows.map(nativeHandle)];
  helper.stdin.write(handles.join(',') + '\n');
}

function moveNoteWindow(win, point) {
  if (!helper || helper.stdin.destroyed) return false;
  helper.stdin.write(`move,${nativeHandle(win)},${point.x},${point.y}\n`);
  return true;
}

function repairDesktopInput() {
  if (!helper || helper.stdin.destroyed) return Promise.resolve('unavailable');
  if (repairRequest) return repairRequest.promise;
  let finish;
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => finish('unavailable'), 2600);
    finish = (status) => {
      clearTimeout(timer);
      repairRequest = null;
      resolve(status);
    };
  });
  repairRequest = { promise, finish };
  helper.stdin.write('repair\n');
  return promise;
}

function stopDesktopOrder() {
  helper?.kill();
  helper = null;
}

module.exports = { maintainDesktopOrder, moveNoteWindow, repairDesktopInput, stopDesktopOrder };
