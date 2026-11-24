const { safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DAV_ROOT = 'https://dav.jianguoyun.com/dav';
const REMOTE_DIR_NAME = 'floating-agenda';
const REMOTE_FILE_NAME = 'floating-agenda.json';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BACKUPS = 20;

let files = null;
let configCache = null;
let statusCache = null;
let inFlight = null;
let pendingPull = null;

function init({ userDataPath }) {
  files = {
    credentials: path.join(userDataPath, 'nutstore-credentials.bin'),
    status: path.join(userDataPath, 'nutstore-status.json'),
    backups: path.join(userDataPath, 'sync-backups'),
  };
  configCache = null;
  statusCache = null;
  pendingPull = null;
}

function remoteDirUrl() {
  return `${DEFAULT_DAV_ROOT}/${REMOTE_DIR_NAME}`;
}

function remoteFileUrl() {
  return `${remoteDirUrl()}/${REMOTE_FILE_NAME}`;
}

function remoteLocation() {
  return `${REMOTE_DIR_NAME}/${REMOTE_FILE_NAME}`;
}

function hashState(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function stateIsEmpty(state) {
  return (!Array.isArray(state.tasks) || state.tasks.length === 0)
    && (!Array.isArray(state.notes) || state.notes.length === 0);
}

function readConfig() {
  if (configCache) return configCache;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(files.credentials);
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.password !== 'string') return null;
    configCache = {
      email: parsed.email,
      password: parsed.password,
      autoSync: parsed.autoSync !== false,
    };
  } catch {
    configCache = null;
  }
  return configCache;
}

function writeConfig(config) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统未提供安全存储，无法保存账号密码');
  const encrypted = safeStorage.encryptString(JSON.stringify(config));
  const temp = `${files.credentials}.tmp`;
  fs.writeFileSync(temp, encrypted);
  fs.renameSync(temp, files.credentials);
  configCache = config;
}

function readStatus() {
  if (statusCache) return statusCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(files.status, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      statusCache = parsed;
      return statusCache;
    }
  } catch {
    // Missing status is expected on first run.
  }
  statusCache = {};
  return statusCache;
}

function updateStatus(patch) {
  statusCache = { ...readStatus(), ...patch };
  try {
    fs.writeFileSync(files.status, JSON.stringify(statusCache, null, 2));
  } catch {
    // Status persistence is best-effort.
  }
  return statusCache;
}

function getStatus() {
  const config = readConfig();
  const status = readStatus();
  return {
    configured: Boolean(config),
    email: config ? config.email : '',
    autoSync: config ? config.autoSync : false,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    remoteLocation: remoteLocation(),
    lastSyncAt: status.lastSyncAt || null,
    lastAttemptAt: status.lastAttemptAt || null,
    lastResult: status.lastResult || null,
    lastError: status.lastError || null,
    remoteSavedAt: status.remoteSavedAt || null,
  };
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.email}:${config.password}`, 'utf8').toString('base64')}`;
}

async function davRequest(method, url, config, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(config),
        ...(options.headers || {}),
      },
      body: options.body,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('连接坚果云超时，请检查网络');
    throw new Error('无法连接坚果云，请检查网络');
  } finally {
    clearTimeout(timer);
  }
}

async function verifyCredentials(config) {
  const body = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
  let response = await davRequest('PROPFIND', `${DEFAULT_DAV_ROOT}/`, config, {
    headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });
  if (response.status === 405 || response.status === 501) {
    response = await davRequest('GET', `${DEFAULT_DAV_ROOT}/`, config);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('账号或应用密码不正确');
  }
  if (!response.ok && response.status !== 207) {
    throw new Error(`坚果云返回错误（HTTP ${response.status}）`);
  }
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneBackups() {
  try {
    const entries = fs.readdirSync(files.backups)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const full = path.join(files.backups, name);
        return { full, time: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.time - a.time);
    entries.slice(MAX_BACKUPS).forEach((entry) => fs.unlinkSync(entry.full));
  } catch {
    // Pruning is best-effort.
  }
}

function writeBackup(prefix, content) {
  try {
    fs.mkdirSync(files.backups, { recursive: true });
    fs.writeFileSync(path.join(files.backups, `${prefix}-${backupStamp()}.json`), content, { flag: 'wx' });
  } catch {
    throw new Error('无法创建本机同步备份，已取消覆盖');
  }
  pruneBackups();
}

function parseRemote(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('云端同步文件不是有效的 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.state || !Array.isArray(parsed.state.tasks) || !Array.isArray(parsed.state.notes)
      || !parsed.state.settings || typeof parsed.state.settings !== 'object') {
    throw new Error('云端同步文件格式不正确');
  }
  return {
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
    state: parsed.state,
  };
}

function summaryOf(state, savedAt) {
  return {
    savedAt: savedAt || null,
    taskCount: Array.isArray(state.tasks) ? state.tasks.length : 0,
    noteCount: Array.isArray(state.notes) ? state.notes.length : 0,
  };
}

async function fetchRemote(config) {
  const response = await davRequest('GET', remoteFileUrl(), config, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return { exists: false };
  if (response.status === 401 || response.status === 403) throw new Error('账号或应用密码不正确');
  if (!response.ok) throw new Error(`读取云端数据失败（HTTP ${response.status}）`);
  const raw = await response.text();
  const remote = parseRemote(raw);
  return {
    exists: true,
    raw,
    state: remote.state,
    savedAt: remote.savedAt,
    hash: hashState(remote.state),
    etag: response.headers.get('etag'),
  };
}

async function ensureRemoteDir(config) {
  const response = await davRequest('MKCOL', remoteDirUrl(), config);
  if (response.status === 401 || response.status === 403) throw new Error('账号或应用密码不正确');
  if (response.status === 201 || response.status === 405) return;
  if (!response.ok) throw new Error(`创建云端目录失败（HTTP ${response.status}）`);
}

async function pushRemote(config, localState, localHash, remote) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (remote?.exists) {
    writeBackup('remote-before-upload', remote.raw);
    if (remote.etag && !remote.etag.startsWith('W/')) headers['If-Match'] = remote.etag;
  } else {
    await ensureRemoteDir(config);
    headers['If-None-Match'] = '*';
  }
  const savedAt = new Date().toISOString();
  const payload = JSON.stringify({
    app: 'floating-agenda',
    version: 1,
    savedAt,
    state: localState,
  }, null, 2);
  const response = await davRequest('PUT', remoteFileUrl(), config, {
    headers,
    body: payload,
  });
  if (response.status === 401 || response.status === 403) throw new Error('账号或应用密码不正确');
  if (response.status === 412) throw new Error('同步期间云端文件有变动，请重新同步');
  if (!response.ok) throw new Error(`上传云端数据失败（HTTP ${response.status}）`);
  updateStatus({
    lastSyncAt: savedAt,
    lastAttemptAt: savedAt,
    lastResult: 'pushed',
    lastError: null,
    lastLocalHash: localHash,
    lastRemoteHash: localHash,
    remoteSavedAt: savedAt,
  });
  return {
    ok: true,
    action: 'pushed',
    message: '已上传到坚果云',
    status: getStatus(),
    remote: summaryOf(localState, savedAt),
  };
}

function pullRemote(remote, localState) {
  writeBackup('local-before-download', JSON.stringify(localState, null, 2));
  pendingPull = { id: crypto.randomUUID(), hash: remote.hash, savedAt: remote.savedAt };
  return {
    ok: true,
    action: 'pulled',
    message: '已从坚果云下载最新数据',
    state: remote.state,
    pullId: pendingPull.id,
    status: getStatus(),
    remote: summaryOf(remote.state, remote.savedAt),
  };
}

function finishPull(id, applied) {
  if (!pendingPull || id !== pendingPull.id) return getStatus();
  const pull = pendingPull;
  pendingPull = null;
  const now = new Date().toISOString();
  if (applied) {
    updateStatus({
      lastSyncAt: now,
      lastAttemptAt: now,
      lastResult: 'pulled',
      lastError: null,
      lastLocalHash: pull.hash,
      lastRemoteHash: pull.hash,
      remoteSavedAt: pull.savedAt,
    });
  } else {
    updateStatus({ lastAttemptAt: now, lastResult: 'conflict' });
  }
  return getStatus();
}

function conflictResult(remote) {
  const status = updateStatus({ lastAttemptAt: new Date().toISOString(), lastResult: 'conflict' });
  return {
    ok: false,
    action: 'conflict',
    message: '云端和本机都有数据，请选择保留哪一份',
    remote: summaryOf(remote.state, remote.savedAt),
    status: getStatus(),
    lastAttemptAt: status.lastAttemptAt,
  };
}

function disabledResult() {
  return { ok: true, action: 'disabled', message: '自动同步未开启', status: getStatus() };
}

async function runSync(localState, options) {
  if (!localState || typeof localState !== 'object' || !Array.isArray(localState.tasks) || !Array.isArray(localState.notes)) {
    return { ok: false, action: 'error', message: '本机日历数据格式不正确，未同步', status: getStatus() };
  }
  const config = readConfig();
  if (!config) {
    return { ok: false, action: 'not-configured', message: '还没有连接坚果云', status: getStatus() };
  }
  const manual = options && options.manual === true;
  const strategy = options && (options.strategy === 'local' || options.strategy === 'remote') ? options.strategy : null;
  if (!manual && !strategy && !config.autoSync) return disabledResult();

  const meta = readStatus();
  const localHash = hashState(localState);
  const remote = await fetchRemote(config);
  const hasBaseline = typeof meta.lastLocalHash === 'string' && typeof meta.lastRemoteHash === 'string';

  if (strategy === 'local') {
    return pushRemote(config, localState, localHash, remote.exists ? remote : null);
  }
  if (strategy === 'remote') {
    if (!remote.exists) {
      return { ok: false, action: 'error', message: '云端还没有数据可以下载', status: getStatus() };
    }
    return pullRemote(remote, localState);
  }

  if (!remote.exists) {
    const result = await pushRemote(config, localState, localHash, null);
    return hasBaseline ? { ...result, message: '云端文件不存在，已重新上传本机数据' } : result;
  }

  if (!hasBaseline) {
    const localEmpty = stateIsEmpty(localState);
    const remoteEmpty = stateIsEmpty(remote.state);
    if (localEmpty && !remoteEmpty) return pullRemote(remote, localState);
    if (!localEmpty && remoteEmpty) return pushRemote(config, localState, localHash, remote);
    if (localHash === remote.hash || (localEmpty && remoteEmpty)) {
      updateStatus({ lastAttemptAt: new Date().toISOString(), lastResult: 'up-to-date', lastError: null, lastLocalHash: localHash, lastRemoteHash: remote.hash, remoteSavedAt: remote.savedAt });
      return {
        ok: true,
        action: 'up-to-date',
        message: '已是最新状态',
        status: getStatus(),
        remote: summaryOf(remote.state, remote.savedAt),
      };
    }
    return conflictResult(remote);
  }

  const localDirty = localHash !== meta.lastLocalHash;
  const remoteDirty = remote.hash !== meta.lastRemoteHash;
  if (localHash === remote.hash || (!localDirty && !remoteDirty)) {
    const now = new Date().toISOString();
    updateStatus({ lastAttemptAt: now, lastResult: 'up-to-date', lastError: null, lastLocalHash: localHash, lastRemoteHash: remote.hash, remoteSavedAt: remote.savedAt });
    return {
      ok: true,
      action: 'up-to-date',
      message: '已是最新状态',
      status: getStatus(),
      remote: summaryOf(remote.state, remote.savedAt),
    };
  }
  if (localDirty && !remoteDirty) {
    return pushRemote(config, localState, localHash, remote);
  }
  if (!localDirty && remoteDirty) {
    return pullRemote(remote, localState);
  }

  return conflictResult(remote);
}

function syncNow(localState, options = {}) {
  if (inFlight || pendingPull) return Promise.resolve({ ok: false, action: 'busy', message: '正在同步，请稍候', status: getStatus() });
  inFlight = runSync(localState, options)
    .catch((error) => {
      const message = error && error.message ? error.message : '同步失败';
      updateStatus({ lastAttemptAt: new Date().toISOString(), lastResult: 'error', lastError: message });
      return { ok: false, action: 'error', message, status: getStatus() };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function connect({ email, appPassword, autoSync }) {
  const trimmedEmail = String(email || '').trim();
  const password = String(appPassword || '');
  if (!trimmedEmail) return { ok: false, message: '请填写坚果云账号邮箱', status: getStatus() };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return { ok: false, message: '邮箱格式不正确', status: getStatus() };
  if (!password) return { ok: false, message: '请填写坚果云应用密码', status: getStatus() };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: '当前系统无法加密保存密码，未连接', status: getStatus() };
  const config = { email: trimmedEmail, password, autoSync: autoSync !== false };
  try {
    await verifyCredentials(config);
    const accountChanged = readConfig()?.email !== config.email;
    writeConfig(config);
    if (accountChanged) {
      updateStatus({ lastLocalHash: null, lastRemoteHash: null, lastSyncAt: null, remoteSavedAt: null });
    }
    updateStatus({ lastError: null, lastResult: 'connected' });
    return { ok: true, message: '连接成功，账号和应用密码已加密保存在本机', status: getStatus() };
  } catch (error) {
    const message = error && error.message ? error.message : '连接失败';
    updateStatus({ lastAttemptAt: new Date().toISOString(), lastResult: 'error', lastError: message });
    return { ok: false, message, status: getStatus() };
  }
}

function disconnect() {
  if (inFlight || pendingPull) return { ok: false, message: '正在同步，请稍候', status: getStatus() };
  try {
    fs.rmSync(files.credentials, { force: true });
  } catch {
    return { ok: false, message: '无法移除本机同步凭据', status: getStatus() };
  }
  configCache = null;
  updateStatus({ lastResult: 'disconnected', lastError: null, lastLocalHash: null, lastRemoteHash: null, lastSyncAt: null, remoteSavedAt: null });
  return { ok: true, message: '已断开坚果云，云端数据不会被删除', status: getStatus() };
}

function setAutoSync(enabled) {
  const config = readConfig();
  if (!config) return { ok: false, message: '还没有连接坚果云', status: getStatus() };
  const next = { ...config, autoSync: enabled === true };
  try {
    writeConfig(next);
  } catch (error) {
    return { ok: false, message: error.message || '保存设置失败', status: getStatus() };
  }
  return { ok: true, message: enabled ? '已开启自动同步' : '已关闭自动同步', status: getStatus() };
}

module.exports = {
  init,
  getStatus,
  connect,
  disconnect,
  setAutoSync,
  syncNow,
  finishPull,
  hasPendingPull: (id) => Boolean(pendingPull && pendingPull.id === id),
  cancelPendingPull: () => { pendingPull = null; },
};