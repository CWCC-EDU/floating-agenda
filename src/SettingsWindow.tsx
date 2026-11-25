import { useEffect, useState } from 'react';
import { SettingsDialog } from './components/SettingsDialog';
import { readLocalSkin } from './lib/skins';
import type { Settings, SettingsWindowState } from './types';

export default function SettingsWindow() {
  const desktop = window.desktop;
  const [snapshot, setSnapshot] = useState<SettingsWindowState | null>(null);
  const [localSkin, setLocalSkin] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const unsubscribe = desktop.onSettingsWindow(setSnapshot);
    void desktop.getSettingsWindow().then(value => { if (active && value) setSnapshot(current => current ?? value); });
    void readLocalSkin().then(value => { if (active) setLocalSkin(value); }).catch(console.warn);
    return () => { active = false; unsubscribe(); };
  }, [desktop]);

  if (!desktop || !snapshot) return null;
  const { state, syncStatus, syncConflict, category } = snapshot;
  function change(next: Settings) {
    const patch = Object.fromEntries(Object.entries(next).filter(([key, value]) => state.settings[key as keyof Settings] !== value));
    setSnapshot(current => current && { ...current, state: { ...current.state, settings: next } });
    desktop?.settingsCommand({ type: 'settings', patch });
  }
  return <main className="settings-standalone window-entrance">
    <SettingsDialog key={category} initialCategory={category} localSkin={localSkin} onLocalSkinChange={image => {
      setLocalSkin(image);
      desktop.settingsCommand({ type: 'skin', image });
    }} settings={state.settings} notes={state.notes} appState={state} isElectron onChange={change}
      onClose={desktop.closeSettingsWindow} onCreateNote={() => desktop.settingsCommand({ type: 'create-note' })}
      onOpenNote={id => desktop.settingsCommand({ type: 'open-note', id })}
      onDestroyNote={id => desktop.settingsCommand({ type: 'delete-note', id })}
      onApplyRemote={(result, expected) => desktop.applySettingsSync(result, expected)}
      syncStatus={syncStatus} onSyncStatusChange={status => {
        setSnapshot(current => current && { ...current, syncStatus: status });
        desktop.settingsCommand({ type: 'sync-status', status });
      }} syncConflict={syncConflict} onSyncConflictChange={conflict => {
        setSnapshot(current => current && { ...current, syncConflict: conflict });
        desktop.settingsCommand({ type: 'sync-conflict', conflict });
      }} />
  </main>;
}
