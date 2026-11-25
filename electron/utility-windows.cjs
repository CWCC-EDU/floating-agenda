const { BrowserWindow, dialog, ipcMain, nativeImage, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const WINDOW_OPTIONS = {
  quick: { title: '快速记一条', width: 478, height: 620, resizable: false, maximizable: false },
  settings: { title: '浮屿设置', width: 790, height: 690, minWidth: 485, minHeight: 365 },
  notes: { title: '浮屿便签列表', width: 390, height: 570, minWidth: 295, minHeight: 280 },
  drawing: { title: '浮屿小画板', width: 900, height: 650, minWidth: 480, minHeight: 340 },
};
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngBuffer(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > 5 * 1024 * 1024) {
    throw new Error('图片过大或格式不正确');
  }
  const content = Buffer.from(bytes);
  if (!content.subarray(0, 8).equals(PNG_HEADER) || content.readUInt32BE(16) > 2400 || content.readUInt32BE(20) > 2400
    || nativeImage.createFromBuffer(content).isEmpty()) throw new Error('无法读取画板图片');
  return content;
}

function validRequestId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
}

function createUtilityWindows(iconPath, persistItem, listNotes) {
  const windows = new Map();

  function open(view, { skipTaskbar = false } = {}) {
    const existing = windows.get(view);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return existing;
    }
    const options = WINDOW_OPTIONS[view];
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(options.width, area.width);
    const height = Math.min(options.height, area.height);
    const win = new BrowserWindow({
      ...options,
      width,
      height,
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor((area.height - height) / 2),
      show: false,
      skipTaskbar,
      autoHideMenuBar: true,
      icon: iconPath(),
      backgroundColor: '#f4f6f5',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    windows.set(view, win);
    win.setMenu(null);
    win.once('ready-to-show', () => win.show());
    win.once('closed', () => windows.delete(view));
    const closeOnLoadFailure = () => { if (!win.isDestroyed()) win.close(); };
    if (process.env.VITE_DEV_SERVER_URL) {
      const url = new URL(process.env.VITE_DEV_SERVER_URL);
      url.searchParams.set('view', view);
      void win.loadURL(url.toString()).catch(closeOnLoadFailure);
    } else {
      void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view } }).catch(closeOnLoadFailure);
    }
    return win;
  }

  function verifySender(event, view) {
    const win = windows.get(view);
    if (!win || win.isDestroyed() || win.webContents !== event.sender) throw new Error('无法验证窗口');
    return win;
  }

  ipcMain.handle('quick:submit', async (event, id, draft) => {
    const win = verifySender(event, 'quick');
    if (!validRequestId(id) || !draft || typeof draft.title !== 'string' || !draft.title.trim()
      || draft.title.length > 1000 || typeof draft.date !== 'string' || typeof draft.time !== 'string'
      || (draft.endTime !== undefined && typeof draft.endTime !== 'string')) throw new Error('请检查日程内容');
    await persistItem({ kind: 'task', id, draft: { title: draft.title.trim(), date: draft.date, time: draft.time,
      endTime: draft.endTime, repeat: draft.repeat, recurrence: draft.recurrence } });
    if (!win.isDestroyed()) win.close();
  });
  ipcMain.handle('quick:close', event => verifySender(event, 'quick').close());
  ipcMain.handle('drawing:export', async (event, bytes) => {
    const win = verifySender(event, 'drawing');
    const content = pngBuffer(bytes);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '保存画板图片',
      defaultPath: '浮屿画板.png',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (canceled || !filePath) return false;
    await fs.writeFile(filePath, content);
    return true;
  });
  ipcMain.handle('drawing:notes', event => {
    verifySender(event, 'drawing');
    return listNotes();
  });
  ipcMain.handle('drawing:note', async (event, id, bytes, targetNoteId) => {
    verifySender(event, 'drawing');
    if (!validRequestId(id) || (targetNoteId !== undefined && !listNotes().some(note => note.id === targetNoteId))) {
      throw new Error('找不到要插入的便签');
    }
    const image = 'data:image/png;base64,' + pngBuffer(bytes).toString('base64');
    await persistItem({ kind: 'image-note', id, image, targetNoteId });
  });

  return { open, get: view => windows.get(view) };
}

module.exports = { createUtilityWindows };
