import { useEffect, useState } from 'react';
import { Cloud, CloudDownload, CloudUpload, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import type { AppState, NutstoreRemoteSummary, NutstoreSyncResult, NutstoreSyncStatus } from '../types';

interface SyncSettingsProps {
  appState: AppState;
  onApplyRemote: (state: unknown) => void;
}

function formatTime(value: string | null): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SyncSettings({ appState, onApplyRemote }: SyncSettingsProps) {
  const desktop = window.desktop;
  const [status, setStatus] = useState<NutstoreSyncStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState<NutstoreRemoteSummary | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    desktop.syncGetStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      setEmail(next.email);
    }).catch(() => {
      if (active) setMessage('无法读取同步设置');
    });
    return () => { active = false; };
  }, [desktop]);

  function showResult(result: NutstoreSyncResult) {
    setStatus(result.status);
    setMessage(result.message);
    setFailed(!result.ok && result.action !== 'conflict');
    if (result.action === 'conflict') {
      setConflict(result.remote ?? { savedAt: null, taskCount: 0, noteCount: 0 });
      return;
    }
    setConflict(null);
    if (result.action === 'pulled' && result.state) onApplyRemote(result.state);
  }

  async function runSync(options: { manual?: boolean; strategy?: 'local' | 'remote' } = { manual: true }) {
    if (!desktop || busy) return;
    setBusy(true);
    setMessage(options.strategy === 'local' ? '正在上传本机数据…' : options.strategy === 'remote' ? '正在下载云端数据…' : '正在同步…');
    setFailed(false);
    try {
      showResult(await desktop.syncNow(appState, options));
    } catch {
      setMessage('同步失败，请稍后重试');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!desktop || busy) return;
    setBusy(true);
    setFailed(false);
    setMessage('正在验证账号…');
    try {
      const result = await desktop.syncConnect({ email: email.trim(), appPassword: password, autoSync: true });
      setStatus(result.status);
      setMessage(result.message);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setPassword('');
      showResult(await desktop.syncNow(appState, { manual: true }));
    } catch {
      setMessage('连接失败，请稍后重试');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoSync(enabled: boolean) {
    if (!desktop) return;
    const result = await desktop.syncSetAutoSync(enabled);
    setStatus(result.status);
    setMessage(result.message);
    setFailed(!result.ok);
  }

  async function disconnect() {
    if (!desktop) return;
    if (!window.confirm('断开坚果云同步？本机日历和云端文件都会保留。')) return;
    setBusy(true);
    try {
      const result = await desktop.syncDisconnect();
      setStatus(result.status);
      setMessage(result.message);
      setFailed(false);
      setConflict(null);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  if (!desktop) {
    return (
      <section className="setting-section">
        <h3>坚果云同步</h3>
        <p className="sync-security">浏览器预览不支持同步。请使用 Windows 桌面版填写账号并连接。</p>
      </section>
    );
  }

  const configured = Boolean(status?.configured);

  return <>
    <section className="setting-section">
      <h3>坚果云同步</h3>
      {!configured && <div className="sync-form">
        <label className="sync-field">
          <span>坚果云账号</span>
          <input type="email" value={email} placeholder="name@example.com" autoComplete="username" disabled={busy} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="sync-field">
          <span>应用密码</span>
          <input type="password" value={password} placeholder="在坚果云网页端生成的应用密码" autoComplete="new-password" disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <p className="sync-hint">请使用「账户信息 → 安全选项 → 第三方应用管理」里生成的应用密码，不是登录密码。</p>
        <button className="sync-primary" type="button" disabled={busy || status?.encryptionAvailable === false} onClick={() => void connect()}>
          <Cloud size={15} />{busy ? '连接中…' : '连接并检测'}
        </button>
        {status && !status.encryptionAvailable && <p className="sync-feedback is-error">当前系统无法加密保存密码，已停止连接。</p>}
      </div>}

      {configured && <>
        <div className="sync-account">
          <span className="sync-account-icon"><Cloud size={17} /></span>
          <div><strong>已连接坚果云</strong><span>{status?.email}</span></div>
          <button type="button" className="sync-text-button" disabled={busy} onClick={() => void disconnect()}><Unplug size={13} />断开</button>
        </div>
        <div className="setting-row">
          <div><strong>自动同步</strong><p>本机数据修改后自动上传，并定期检查云端更新</p></div>
          <button className={`switch ${status?.autoSync ? 'is-on' : ''}`} type="button" role="switch" aria-checked={Boolean(status?.autoSync)} aria-label="自动同步" disabled={busy} onClick={() => void toggleAutoSync(!status?.autoSync)}><span /></button>
        </div>
        <div className="sync-status-line">
          <span>上次同步：{formatTime(status?.lastSyncAt ?? null)}</span>
          <span>云端文件：{status?.remoteLocation}</span>
        </div>
        <button className="sync-primary" type="button" disabled={busy} onClick={() => void runSync({ manual: true })}>
          <RefreshCw size={15} className={busy ? 'is-spinning' : ''} />{busy ? '同步中…' : '立即同步'}
        </button>
      </>}

      {message && <p className={`sync-feedback ${failed ? 'is-error' : ''}`}>{message}</p>}

      {conflict && <div className="sync-conflict">
        <strong>云端也有数据</strong>
        <p>云端有 {conflict.taskCount} 项日程、{conflict.noteCount} 条便签（{formatTime(conflict.savedAt)}）；本机已有一份日历。请选择保留哪一份，被覆盖的一份会备份在本机。</p>
        <div className="sync-conflict-actions">
          <button type="button" disabled={busy} onClick={() => void runSync({ manual: true, strategy: 'local' })}><CloudUpload size={14} />上传本机</button>
          <button type="button" disabled={busy} onClick={() => void runSync({ manual: true, strategy: 'remote' })}><CloudDownload size={14} />下载云端</button>
        </div>
      </div>}
    </section>

    <section className="setting-section">
      <h3>安全与备份</h3>
      <ul className="sync-security">
        <li><ShieldCheck size={14} />账号与应用密码用 Windows 系统加密（DPAPI）保存在本机，只在连接坚果云时使用，不会写入日历数据，也不会显示在界面上。</li>
        <li>同步数据保存在你自己的坚果云 <code>{status?.remoteLocation ?? 'floating-agenda/floating-agenda.json'}</code>。</li>
        <li>覆盖前会把旧版本备份到本机 <code>sync-backups</code> 文件夹，最多保留 20 份。</li>
        <li>其他电脑安装浮屿后，输入同一个坚果云账号和应用密码即可获取云端日历。</li>
      </ul>
    </section>
  </>;
}