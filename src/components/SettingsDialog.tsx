import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronRight, Cloud, Info, Keyboard, LayoutGrid, Monitor, RotateCcw, SlidersHorizontal, StickyNote as StickyNoteIcon, Type, X } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { importLocalSkin, skinImage, SKIN_OPTIONS } from '../lib/skins';
import { SyncSettings } from './SyncSettings';
import type { AppState, NutstoreRemoteSummary, NutstoreSyncResult, NutstoreSyncStatus, BulletStyle, CalendarDisplayStatus, CalendarLayout, DesktopIconLayer, EditorInputStyle, FontFamily, Settings, SkinPosition, SoundEffect, StickyNote, TextBackground, UpdateCheckResult } from '../types';

type Category = 'calendar' | 'cells' | 'appearance' | 'notes' | 'sync' | 'advanced' | 'about';
type ShortcutKey = 'showHideShortcut' | 'quickCaptureShortcut' | 'toggleContentShortcut' | 'toggleNotesShortcut' | 'completeTaskShortcut';

interface SettingsDialogProps {
  initialCategory: Category;
  localSkin: string | null;
  onLocalSkinChange: (image: string) => void;
  settings: Settings;
  notes: StickyNote[];
  appState: AppState;
  isElectron: boolean;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  onCreateNote: () => void;
  onOpenNote: (id: string) => void;
  onDestroyNote: (id: string) => void;
  onApplyRemote: (result: NutstoreSyncResult, expected: AppState) => Promise<NutstoreSyncResult>;
  syncStatus: NutstoreSyncStatus | null;
  onSyncStatusChange: (status: NutstoreSyncStatus) => void;
  syncConflict: NutstoreRemoteSummary | null;
  onSyncConflictChange: (summary: NutstoreRemoteSummary | null) => void;
}

const CATEGORIES = [
  { id: 'calendar', label: '日历', icon: CalendarDays },
  { id: 'cells', label: '单元格', icon: LayoutGrid },
  { id: 'appearance', label: '字体和颜色', icon: Type },
  { id: 'notes', label: '便签', icon: StickyNoteIcon },
  { id: 'sync', label: '同步', icon: Cloud },
  { id: 'advanced', label: '高级', icon: SlidersHorizontal },
  { id: 'about', label: '关于', icon: Info },
] as const;

const LAYOUTS: { value: CalendarLayout; label: string }[] = [
  { value: 'floating-month', label: '浮动月份' },
  { value: 'full-month', label: '完整月份' },
  { value: 'fixed-week', label: '固定单行' },
  { value: 'floating-week', label: '浮动单行' },
];
const BULLETS: { value: BulletStyle; label: string }[] = [
  { value: 'none', label: '无项目符号' },
  { value: 'number', label: '项目数字编号' },
  { value: 'dot', label: '项目圆点' },
];
const EDITOR_STYLES: { value: EditorInputStyle; label: string }[] = [
  { value: 'one-box', label: '一条式' },
  { value: 'multi-row', label: '多条式' },
];
const DESKTOP_ICON_LAYERS: { value: DesktopIconLayer; label: string }[] = [
  { value: 'below', label: '日历在图标上方（默认）' },
  { value: 'above', label: '日历在图标下方' },
];
const SKIN_POSITIONS: { value: SkinPosition; label: string }[] = [
  { value: 'center', label: '居中' }, { value: 'left', label: '左侧' }, { value: 'right', label: '右侧' },
  { value: 'top', label: '顶部' }, { value: 'bottom', label: '底部' },
];
const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'PingFang SC', label: '苹方' },
  { value: 'SimSun', label: '宋体' },
];
const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const SHORTCUT_DEFAULTS: Record<ShortcutKey, string> = {
  showHideShortcut: 'Control+Shift+Space',
  quickCaptureShortcut: '',
  toggleContentShortcut: 'Control+Alt+F',
  toggleNotesShortcut: 'Control+Alt+B',
  completeTaskShortcut: 'Control+Alt+E',
};

function ToggleRow({ title, description, checked, disabled, onChange }: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div><strong>{title}</strong>{description && <p>{description}</p>}</div>
      <button className={`switch ${checked ? 'is-on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={title} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
    </div>
  );
}

function SelectRow<T extends string | number>({ title, description, value, options, disabled, onChange }: {
  title: string;
  description?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className={`setting-row setting-select-row ${disabled ? 'is-disabled' : ''}`}>
      <div><strong>{title}</strong>{description && <p>{description}</p>}</div>
      <select value={value} disabled={disabled} onChange={(event) => onChange((typeof value === 'number' ? Number(event.target.value) : event.target.value) as T)}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CalendarDisplaySetting() {
  const desktop = window.desktop;
  const [status, setStatus] = useState<CalendarDisplayStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const unsubscribe = desktop.onCalendarDisplays((next) => { setStatus(next); setFailed(false); });
    void desktop.getCalendarDisplays()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  if (!desktop) return null;

  const options = [{ value: 'primary', label: '主屏幕（默认）' }, ...(status?.options ?? [])];
  if (status?.usingFallback) options.push({ value: status.selected, label: '首选屏幕（未连接）' });
  const description = failed ? '无法读取显示屏幕设置'
    : status?.usingFallback ? '首选屏幕未连接，日历当前显示在主屏幕'
    : '此设置仅在当前电脑生效';
  return <SelectRow title="显示屏幕" value={status?.selected ?? 'primary'} options={options}
    description={description} disabled={!status} onChange={(value) => {
      void desktop.setCalendarDisplay(value).then((next) => { setStatus(next); setFailed(false); }).catch(() => setFailed(true));
    }} />;
}

function ColorRow({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="setting-row setting-color-row">
      <div><strong>{title}</strong></div>
      <span className="color-control"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><code>{value.toUpperCase()}</code></span>
    </label>
  );
}

function RangeRow({ title, value, min, max, unit, onChange }: { title: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <div className="setting-range-row">
      <div><strong>{title}</strong><span>{value}{unit}</span></div>
      <input className="opacity-slider" type="range" min={min} max={max} value={value} aria-label={title} style={{ '--range-progress': `${(value - min) / (max - min) * 100}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

function FontRow({ title, family, size, color, onFamily, onSize, onColor }: {
  title: string;
  family: FontFamily;
  size: number;
  color: string;
  onFamily: (value: FontFamily) => void;
  onSize: (value: number) => void;
  onColor: (value: string) => void;
}) {
  return (
    <div className="setting-row font-setting-row">
      <div><strong>{title}</strong></div>
      <div className="font-controls">
        <input type="color" aria-label={`${title}颜色`} value={color} onChange={(event) => onColor(event.target.value)} />
        <select aria-label={`${title}字体`} value={family} onChange={(event) => onFamily(event.target.value as FontFamily)}>{FONT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        <select aria-label={`${title}大小`} value={size} onChange={(event) => onSize(Number(event.target.value))}>{Array.from({ length: 14 }, (_, index) => index + 9).map((fontSize) => <option value={fontSize} key={fontSize}>{fontSize}px</option>)}</select>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="setting-section"><h3>{title}</h3>{children}</section>;
}

function ChoiceCards<T extends string>({ value, options, kind, onChange }: { value: T; options: readonly { value: T; label: string }[]; kind: 'layout' | 'bullet'; onChange: (value: T) => void }) {
  return (
    <div className="setting-choice-grid">
      {options.map((option) => (
        <button type="button" className={value === option.value ? 'is-active' : ''} key={option.value} onClick={() => onChange(option.value)}>
          <span className={`choice-preview ${kind}-${option.value}`} aria-hidden="true">
            {kind === 'layout' ? Array.from({ length: option.value.includes('week') ? 7 : 12 }, (_, index) => <i key={index} />) : <b>{option.value === 'number' ? '1.\n2.\n3.' : option.value === 'dot' ? '●\n●\n●' : '—\n—\n—'}</b>}
          </span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function shortcutFromEvent(event: KeyboardEvent<HTMLInputElement>): string {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return '';
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join('+');
}

function ShortcutRow({ title, setting, value, disabled, onChange }: { title: string; setting: ShortcutKey; value: string; disabled?: boolean; onChange: (setting: ShortcutKey, value: string) => void }) {
  const usesCustomShortcut = setting === 'quickCaptureShortcut';
  return (
    <div className="setting-row shortcut-setting-row">
      <div><strong>{title}</strong><p>点击快捷键框，再按下新的组合键</p></div>
      <input className="shortcut-input" aria-label={`${title}快捷键`} value={value} placeholder={usesCustomShortcut ? '未设置' : '已关闭'} readOnly disabled={disabled || (!usesCustomShortcut && !value)} onKeyDown={(event) => {
        event.preventDefault();
        if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') onChange(setting, '');
        else {
          const shortcut = shortcutFromEvent(event);
          if (shortcut) onChange(setting, shortcut);
        }
      }} />
      {usesCustomShortcut
        ? <button className="icon-button" type="button" aria-label="清除速记快捷键" disabled={disabled || !value} onClick={() => onChange(setting, '')}><X size={14} /></button>
        : <button className={`switch ${value ? 'is-on' : ''}`} type="button" role="switch" aria-checked={Boolean(value)} aria-label={`启用${title}`} disabled={disabled} onClick={() => onChange(setting, value ? '' : SHORTCUT_DEFAULTS[setting])}><span /></button>}
    </div>
  );
}

export function SettingsDialog({ initialCategory, localSkin, onLocalSkinChange, settings, notes, appState, isElectron, onChange, onClose, onCreateNote, onOpenNote, onDestroyNote, onApplyRemote, syncStatus, onSyncStatusChange, syncConflict, onSyncConflictChange }: SettingsDialogProps) {
  const [category, setCategory] = useState<Category>(initialCategory);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [skinError, setSkinError] = useState('');
  const [importingSkin, setImportingSkin] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState('');
  const previewSkin = skinImage(settings.imageSkin, localSkin);
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const updateShortcut = (setting: ShortcutKey, value: string) => update({ [setting]: value });
  const numberOptions = (min: number, max: number, unit = '') => Array.from({ length: max - min + 1 }, (_, index) => ({ value: min + index, label: `${min + index}${unit}` }));
  const backgroundOptions: { value: TextBackground; label: string }[] = [{ value: 'none', label: '关闭' }, { value: 'soft', label: '柔和' }, { value: 'solid', label: '实色' }];
  const soundOptions: { value: SoundEffect; label: string }[] = [{ value: 'none', label: '无' }, { value: 'tick', label: '滴答' }, { value: 'chime', label: '小星星' }];
  const closedBlankNotes = notes.filter((note) => !note.open && !note.image && !note.text.trim());
  const title = CATEGORIES.find((item) => item.id === category)?.label ?? '日历设置';

  async function checkUpdates() {
    if (!window.desktop) {
      setUpdateResult({ status: 'unavailable', message: '浏览器预览不提供安装包更新检查。' });
      return;
    }
    setUpdateResult({ status: 'unavailable', message: '正在检查…' });
    setUpdateResult(await window.desktop.checkForUpdates());
  }

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-window-header"><strong>日历清单 · 设置</strong><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="settings-layout">
          <aside className="settings-sidebar">
            <nav aria-label="设置分类">{CATEGORIES.map((item) => {
              const Icon = item.icon;
              return <button type="button" className={category === item.id ? 'is-active' : ''} key={item.id} onClick={() => setCategory(item.id)}><Icon size={16} /><span>{item.label}</span></button>;
            })}</nav>
            <button className="reset-settings" type="button" onClick={() => {
              if (window.confirm('恢复所有显示与高级设置？任务和便签不会被删除。')) onChange({ ...DEFAULT_SETTINGS, restDays: [...DEFAULT_SETTINGS.restDays] });
            }}><RotateCcw size={13} />恢复默认设置</button>
          </aside>

          <div className="settings-main">
            <header className="settings-page-header"><span className="eyebrow">PREFERENCES</span><h2 id="settings-title">{title}</h2></header>
            <div className="settings-content">
              {category === 'calendar' && <>
                <Section title="视图">
                  <SelectRow title="当前视图" value={settings.calendarView} options={[{ value: 'day' as const, label: '日视图' }, { value: 'week' as const, label: '周视图' }, { value: 'month' as const, label: '月视图' }]} onChange={(calendarView) => update({ calendarView })} />
                  <ToggleRow title="显示左上角视图切换" description="关闭后仍可在这里选择当前视图" checked={settings.showCalendarViewSwitch} onChange={(showCalendarViewSwitch) => update({ showCalendarViewSwitch })} />
                  <ToggleRow title="启用时间轴" description="月、周、日视图共用此设置" checked={settings.showTimeAxis} onChange={(showTimeAxis) => update({ showTimeAxis })} />
                  <ColorRow title="当前时间线颜色" value={settings.currentTimeLineColor} onChange={(currentTimeLineColor) => update({ currentTimeLineColor })} />
                </Section>
                <Section title="月视图样式">
                  <ChoiceCards value={settings.layout} options={LAYOUTS} kind="layout" onChange={(layout) => update({ layout })} />
                  <SelectRow title="最大行数" description={settings.layout === 'full-month' ? '完整月份会自动补齐整月所需的 4–6 行' : undefined} value={settings.maxRows} options={numberOptions(1, 6)} disabled={settings.layout.includes('week') || settings.layout === 'full-month'} onChange={(maxRows) => update({ maxRows })} />
                  <SelectRow title="已过星期数" description="浮动月份保留今天之前的完整周数" value={settings.elapsedWeeks} options={numberOptions(0, 5)} disabled={settings.layout !== 'floating-month'} onChange={(elapsedWeeks) => update({ elapsedWeeks })} />
                  <SelectRow title="最大列数" description={settings.layout === 'full-month' ? '完整月份固定使用 7 列，显示完整周' : undefined} value={settings.maxColumns} options={numberOptions(1, 7)} disabled={settings.layout === 'full-month'} onChange={(maxColumns) => update({ maxColumns })} />
                  <ToggleRow title="显示月间隔" checked={settings.showMonthSeparator} onChange={(showMonthSeparator) => update({ showMonthSeparator })} />
                </Section>
                <Section title="显示效果">
                  <ToggleRow title="毛玻璃特效" checked={settings.blurEnabled} onChange={(blurEnabled) => update({ blurEnabled })} />
                  <ToggleRow title="显示周数" checked={settings.showWeekNumbers} onChange={(showWeekNumbers) => update({ showWeekNumbers })} />
                  <ToggleRow title="显示阴影" checked={settings.showShadow} onChange={(showShadow) => update({ showShadow })} />
                  <ToggleRow title="显示标题栏" description="隐藏后仍可通过 Windows 托盘打开设置" checked={settings.showTitleBar} onChange={(showTitleBar) => update({ showTitleBar })} />
                </Section>
                <Section title="节日">
                  <ToggleRow title="显示法定休息日" checked={settings.showLegalHolidays} onChange={(showLegalHolidays) => update({ showLegalHolidays })} />
                  <ToggleRow title="显示重要节日" checked={settings.showImportantFestivals} onChange={(showImportantFestivals) => update({ showImportantFestivals })} />
                  <SelectRow title="节假日地区" value={settings.festivalRegion} options={[{ value: 'CN' as const, label: '中国大陆' }]} onChange={(festivalRegion) => update({ festivalRegion })} />
                </Section>
                <Section title="农历节气">
                  <ToggleRow title="显示农历" checked={settings.showLunar} onChange={(showLunar) => update({ showLunar })} />
                  <ToggleRow title="显示二十四节气" checked={settings.showSolarTerms} onChange={(showSolarTerms) => update({ showSolarTerms })} />
                  <ToggleRow title="显示宜忌提示" description="鼠标停留在农历日期上查看" checked={settings.showYiJi} onChange={(showYiJi) => update({ showYiJi })} />
                </Section>
              </>}

              {category === 'cells' && <>
                <Section title="月视图单元格样式">
                  <ChoiceCards value={settings.bulletStyle} options={BULLETS} kind="bullet" onChange={(bulletStyle) => update({ bulletStyle, autoNumber: bulletStyle === 'number' })} />
                  <SelectRow title="单元格间隙" value={settings.cellGap} options={numberOptions(0, 8)} onChange={(cellGap) => update({ cellGap })} />
                  <SelectRow title="行间距" value={settings.rowGap} options={numberOptions(0, 8)} onChange={(rowGap) => update({ rowGap })} />
                </Section>
                <Section title="功能">
                  <ToggleRow title="显示完成勾选框" description="默认关闭；完成状态仍用删除线表示" checked={settings.showCompletedCheckbox} onChange={(showCompletedCheckbox) => update({ showCompletedCheckbox })} />
                  <ToggleRow title="编辑完成自动排到末尾" checked={settings.completedToBottom} onChange={(completedToBottom) => update({ completedToBottom })} />
                  <ToggleRow title="显示已完成任务" checked={settings.showCompletedTasks} onChange={(showCompletedTasks) => update({ showCompletedTasks })} />
                  <ToggleRow title="显示已完成图标" checked={settings.showCompletedIcon} onChange={(showCompletedIcon) => update({ showCompletedIcon })} />
                  <ToggleRow title="显示日程时间段" checked={settings.showReminderTime} onChange={(showReminderTime) => update({ showReminderTime })} />
                  <ToggleRow title="启用日程提醒" description="到达开始时间时显示本机通知并播放提示音" checked={settings.remindersEnabled} onChange={(remindersEnabled) => update({ remindersEnabled })} />
                  <ToggleRow title="未完成任务自动顺延" checked={settings.rolloverEnabled} onChange={(rolloverEnabled) => update({ rolloverEnabled })} />
                  <SelectRow title="自动顺延范围" value={settings.rolloverWindow} options={numberOptions(1, 30, ' 天')} disabled={!settings.rolloverEnabled} onChange={(rolloverWindow) => update({ rolloverWindow })} />
                  <ToggleRow title="顺延任务高亮" description="被顺延过的未完成任务使用指定颜色显示" checked={settings.rolloverHighlightEnabled} disabled={!settings.rolloverEnabled} onChange={(rolloverHighlightEnabled) => update({ rolloverHighlightEnabled })} />
                  {settings.rolloverEnabled && settings.rolloverHighlightEnabled && <ColorRow title="顺延任务颜色" value={settings.rolloverHighlightColor} onChange={(rolloverHighlightColor) => update({ rolloverHighlightColor })} />}
                  <ToggleRow title="在原日期保留顺延分身" description="原定日期显示带「顺延」标记的浅色记录，点击可打开当前任务" checked={settings.rolloverGhostEnabled} disabled={!settings.rolloverEnabled} onChange={(rolloverGhostEnabled) => update({ rolloverGhostEnabled })} />
                  <SelectRow title="显示文字背景" value={settings.taskTextBackground} options={backgroundOptions} onChange={(taskTextBackground) => update({ taskTextBackground })} />
                </Section>
                <Section title="任务密度与滚动">
                  <SelectRow title="月视图初始字号" value={settings.taskBaseFontSize} options={numberOptions(8, 20, 'px')} onChange={(taskBaseFontSize) => update({ taskBaseFontSize, taskMinFontSize: Math.min(settings.taskMinFontSize, taskBaseFontSize) })} />
                  <SelectRow title="月视图最小字号" value={settings.taskMinFontSize} options={numberOptions(6, settings.taskBaseFontSize, 'px')} onChange={(taskMinFontSize) => update({ taskMinFontSize })} />
                  <SelectRow title="周视图初始字号" value={settings.weekTaskBaseFontSize} options={numberOptions(8, 20, 'px')} onChange={(weekTaskBaseFontSize) => update({ weekTaskBaseFontSize, weekTaskMinFontSize: Math.min(settings.weekTaskMinFontSize, weekTaskBaseFontSize) })} />
                  <SelectRow title="周视图最小字号" value={settings.weekTaskMinFontSize} options={numberOptions(6, settings.weekTaskBaseFontSize, 'px')} onChange={(weekTaskMinFontSize) => update({ weekTaskMinFontSize })} />
                  <SelectRow title="日视图初始字号" value={settings.dayTaskBaseFontSize} options={numberOptions(8, 20, 'px')} onChange={(dayTaskBaseFontSize) => update({ dayTaskBaseFontSize, dayTaskMinFontSize: Math.min(settings.dayTaskMinFontSize, dayTaskBaseFontSize) })} />
                  <SelectRow title="日视图最小字号" value={settings.dayTaskMinFontSize} options={numberOptions(6, settings.dayTaskBaseFontSize, 'px')} onChange={(dayTaskMinFontSize) => update({ dayTaskMinFontSize })} />
                  <SelectRow title="缩字条数上限" description="月视图按条数缩字。日、周清单空间不足时可继续缩到最小字号。" value={settings.taskScrollThreshold} options={numberOptions(2, 30, ' 条')} onChange={(taskScrollThreshold) => update({ taskScrollThreshold })} />
                </Section>
                <Section title="提示音效">
                  <SelectRow title="编辑完成提示音" value={settings.editSaveSound} options={soundOptions} onChange={(editSaveSound) => update({ editSaveSound })} />
                  <SelectRow title="提醒通知提示音" value={settings.reminderSound} options={soundOptions} onChange={(reminderSound) => update({ reminderSound })} />
                </Section>
              </>}

              {category === 'appearance' && <>
                <Section title="主题皮肤">
                  <SelectRow title="日历背景" value={settings.imageSkin} options={SKIN_OPTIONS} onChange={(imageSkin) => update({ imageSkin })} />
                  <label className="skin-import">
                    <span>{importingSkin ? '正在处理图片…' : '导入本机图片'}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={importingSkin} onChange={async (event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (!file) return;
                      setSkinError('');
                      setImportingSkin(true);
                      try {
                        onLocalSkinChange(await importLocalSkin(file));
                        update({ imageSkin: 'local' });
                      } catch (error) {
                        setSkinError(error instanceof Error ? error.message : '导入图片失败');
                      } finally {
                        setImportingSkin(false);
                      }
                    }} />
                  </label>
                  {skinError && <p className="skin-error" role="alert">{skinError}</p>}
                  {settings.imageSkin === 'local' && !localSkin && <p className="skin-hint">选择一张本机图片即可启用该主题。</p>}
                  {previewSkin && <img className="skin-preview" alt="主题图片预览" src={previewSkin} style={{ objectPosition: settings.skinPosition }} />}
                  {settings.imageSkin !== 'none' && <>
                    <SelectRow title="图片对齐" value={settings.skinPosition} options={SKIN_POSITIONS} onChange={(skinPosition) => update({ skinPosition })} />
                    <RangeRow title="图片不透明度" value={settings.skinOpacity} min={10} max={100} unit="%" onChange={(skinOpacity) => update({ skinOpacity })} />
                    <RangeRow title="图片压暗" value={settings.skinShade} min={0} max={85} unit="%" onChange={(skinShade) => update({ skinShade })} />
                  </>}
                </Section>
                <Section title="文字的字体颜色和大小">
                  <FontRow title="日历日期" family={settings.calendarFontFamily} size={settings.calendarFontSize} color={settings.calendarTextColor} onFamily={(calendarFontFamily) => update({ calendarFontFamily })} onSize={(calendarFontSize) => update({ calendarFontSize })} onColor={(calendarTextColor) => update({ calendarTextColor })} />
                  <FontRow title="编辑内容" family={settings.editorFontFamily} size={settings.editorFontSize} color={settings.editorTextColor} onFamily={(editorFontFamily) => update({ editorFontFamily })} onSize={(editorFontSize) => update({ editorFontSize })} onColor={(editorTextColor) => update({ editorTextColor })} />
                  <SelectRow title="输入框样式" description="一条式：单个文本框，每行一项；多条式：每项独立输入框" value={settings.editorInputStyle} options={EDITOR_STYLES} onChange={(editorInputStyle) => update({ editorInputStyle })} />
                  <ToggleRow title="任务文字随背景自动配色" description="按背景明暗自动选择高对比度文字" checked={settings.taskAdaptiveColor} onChange={(taskAdaptiveColor) => update({ taskAdaptiveColor })} />
                  {!settings.taskAdaptiveColor && <ColorRow title="任务文字颜色" value={settings.taskTextColor} onChange={(taskTextColor) => update({ taskTextColor })} />}
                </Section>
                <Section title="其他颜色">
                  <ColorRow title="日历背景颜色" value={settings.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} />
                  <ColorRow title="休息日背景颜色" value={settings.restDayBackgroundColor} onChange={(restDayBackgroundColor) => update({ restDayBackgroundColor })} />
                  <ColorRow title="今日边框颜色" value={settings.todayColor} onChange={(todayColor) => update({ todayColor })} />
                  <ColorRow title="标题栏按钮颜色" value={settings.titleButtonColor} onChange={(titleButtonColor) => update({ titleButtonColor })} />
                  <ColorRow title="节假日文字颜色" value={settings.festivalTextColor} onChange={(festivalTextColor) => update({ festivalTextColor })} />
                  <ColorRow title="二十四节气文字颜色" value={settings.solarTermTextColor} onChange={(solarTermTextColor) => update({ solarTermTextColor })} />
                </Section>
                <Section title="透明度">
                  <RangeRow title="日历不透明度" value={settings.opacity} min={0} max={100} unit="%" onChange={(opacity) => update({ opacity })} />
                  <ToggleRow title="毛玻璃特效" checked={settings.blurEnabled} onChange={(blurEnabled) => update({ blurEnabled })} />
                </Section>
              </>}

              {category === 'notes' && <>
                <Section title="便签管理">
                  <button className="settings-link-button" type="button" onClick={onCreateNote}><span>新建便签窗口</span><ChevronRight size={16} /></button>
                  {closedBlankNotes.length > 0 && (
                    <button className="settings-link-button settings-note-destroy" type="button" onClick={() => {
                      if (window.confirm(`永久销毁 ${closedBlankNotes.length} 张已关闭的空白便签？`)) {
                        closedBlankNotes.forEach((note) => onDestroyNote(note.id));
                      }
                    }}>销毁已关闭的空白便签（{closedBlankNotes.length}）</button>
                  )}
                  {notes.map((note) => (
                    <div className="settings-note-entry" key={note.id}>
                      <button className="settings-note-row" type="button" title={note.image ? '画板便签' : note.text || '空白便签'} onClick={() => onOpenNote(note.id)}>
                        <span>{note.image ? '画板便签' : (note.text.trim().split('\n')[0] || '空白便签').slice(0, 40)}</span>
                        <em className={note.open ? 'is-open' : ''}>{note.open ? '已打开' : '已关闭'}</em>
                      </button>
                      <button className="settings-note-destroy" type="button" onClick={() => {
                        if (window.confirm('永久销毁这张便签？')) onDestroyNote(note.id);
                      }}>销毁</button>
                    </div>
                  ))}
                  {notes.length === 0 && <p className="settings-note-empty">还没有便签。</p>}
                </Section>
                <Section title="便签外观">
                  {!isElectron && <ToggleRow title="显示桌面便签" checked={settings.showNotes} onChange={(showNotes) => update({ showNotes })} />}
                  <ChoiceCards value={settings.noteBulletStyle} options={BULLETS} kind="bullet" onChange={(noteBulletStyle) => update({ noteBulletStyle })} />
                  <RangeRow title="便签不透明度" value={settings.noteOpacity} min={0} max={100} unit="%" onChange={(noteOpacity) => update({ noteOpacity })} />
                  <SelectRow title="行间距" value={settings.noteRowGap} options={numberOptions(0, 8)} onChange={(noteRowGap) => update({ noteRowGap })} />
                  <FontRow title="便签内容" family={settings.noteFontFamily} size={settings.noteFontSize} color={settings.noteTextColor} onFamily={(noteFontFamily) => update({ noteFontFamily })} onSize={(noteFontSize) => update({ noteFontSize })} onColor={(noteTextColor) => update({ noteTextColor })} />
                  <SelectRow title="显示文字背景" value={settings.noteTextBackground} options={backgroundOptions} onChange={(noteTextBackground) => update({ noteTextBackground })} />
                  <ToggleRow title="显示完成勾选框" checked={settings.showNoteCheckbox} onChange={(showNoteCheckbox) => update({ showNoteCheckbox })} />
                </Section>

              </>}

              {category === 'sync' && <SyncSettings appState={appState} onApplyRemote={onApplyRemote} status={syncStatus} onStatusChange={onSyncStatusChange} conflict={syncConflict} onConflictChange={onSyncConflictChange} />}

              {category === 'advanced' && <>
                <Section title="高级设置">
                  <CalendarDisplaySetting />
                  <SelectRow title="桌面图标层级" description="日历在图标下方时，重叠的图标仍可点击。普通应用窗口始终优先显示。" value={settings.desktopIconLayer} options={DESKTOP_ICON_LAYERS} disabled={!isElectron} onChange={(desktopIconLayer) => update({ desktopIconLayer })} />
                  {isElectron && <button type="button" className="settings-link-button" disabled={repairing} onClick={async () => {
                    setRepairing(true);
                    try {
                      setRepairMessage(await window.desktop?.repairDesktopInput() ?? '暂时无法修复桌面输入。');
                    } catch {
                      setRepairMessage('暂时无法修复桌面输入。');
                    } finally {
                      setRepairing(false);
                    }
                  }}><span>修复桌面图标点击</span><ChevronRight size={16} /></button>}
                  {repairMessage && <p className="update-result" role="status">{repairMessage}</p>}
                  <SelectRow title="开始星期" value={settings.weekStartsOn} options={WEEKDAY_NAMES.map((label, value) => ({ value, label }))} onChange={(weekStartsOn) => update({ weekStartsOn })} />
                  <SelectRow title="设置第一周" description="ISO 周或包含 1 月 1 日的第一周" value={settings.weekNumberMode} options={[{ value: 'iso' as const, label: 'ISO 标准周' }, { value: 'jan1' as const, label: '包含 1 月 1 日' }]} onChange={(weekNumberMode) => update({ weekNumberMode })} />
                </Section>
                <Section title="休息日">
                  <ToggleRow title="显示休息日" checked={settings.showRestDays} onChange={(showRestDays) => update({ showRestDays })} />
                  <div className="rest-day-picker"><strong>选择休息日</strong><div>{WEEKDAY_NAMES.map((label, day) => <label key={label}><input type="checkbox" checked={settings.restDays.includes(day)} onChange={() => update({ restDays: settings.restDays.includes(day) ? settings.restDays.filter((item) => item !== day) : [...settings.restDays, day].sort() })} /><span>{label.replace('星期', '周')}</span></label>)}</div></div>
                </Section>
                <Section title="快捷键">
                  <ShortcutRow title="快速记一条" setting="quickCaptureShortcut" value={settings.quickCaptureShortcut} disabled={!isElectron} onChange={updateShortcut} />
                  <ShortcutRow title="显示 / 隐藏日历" setting="showHideShortcut" value={settings.showHideShortcut} disabled={!isElectron} onChange={updateShortcut} />
                  <ShortcutRow title="显示 / 隐藏日历内容" setting="toggleContentShortcut" value={settings.toggleContentShortcut} disabled={!isElectron} onChange={updateShortcut} />
                  <ShortcutRow title="显示 / 隐藏便签" setting="toggleNotesShortcut" value={settings.toggleNotesShortcut} disabled={!isElectron} onChange={updateShortcut} />
                  <ShortcutRow title="完成选中日期首项任务" setting="completeTaskShortcut" value={settings.completeTaskShortcut} disabled={!isElectron} onChange={updateShortcut} />
                </Section>
                <Section title="软件设置">
                  <SelectRow title="语言" value={settings.language} options={[{ value: 'zh-CN' as const, label: '中国大陆 · 简体中文' }]} onChange={(language) => update({ language })} />
                  <ToggleRow title="代理设置" description="仅用于应用自身的更新检查，不上传任务内容" checked={settings.proxyEnabled} disabled={!isElectron} onChange={(proxyEnabled) => update({ proxyEnabled })} />
                  {settings.proxyEnabled && <label className="proxy-input-row"><span>代理服务器</span><input value={settings.proxyServer} placeholder="例如 127.0.0.1:7890" onChange={(event) => update({ proxyServer: event.target.value })} /></label>}
                  <ToggleRow title="跟随 Windows 启动" description="使用当前便携 EXE 注册本机登录启动项" checked={settings.autoStartEnabled} disabled={!isElectron} onChange={(autoStartEnabled) => update({ autoStartEnabled })} />
                  <ToggleRow title="自动检查更新" checked={settings.autoCheckUpdates} disabled={!isElectron} onChange={(autoCheckUpdates) => update({ autoCheckUpdates })} />
                  <button className="settings-link-button" type="button" onClick={() => void checkUpdates()}><span>立即检查更新</span><ChevronRight size={16} /></button>
                  {updateResult && <p className={`update-result is-${updateResult.status}`}>{updateResult.message}</p>}
                </Section>
              </>}

              {category === 'about' && <>
                <Section title="浮屿桌面日历"><div className="about-panel"><Monitor size={28} /><strong>透明桌面月历 · 本地便携版</strong><p>任务、便签和设置默认保存在这台电脑。只有在你主动连接坚果云后，日历数据才会同步到你自己的坚果云。</p></div></Section>
                <Section title="常用操作"><div className="about-shortcuts"><span><Keyboard size={14} />新建日程</span><kbd>Ctrl + N</kbd><span>隐藏 / 唤起</span><kbd>{settings.showHideShortcut || '未启用'}</kbd><span>编辑日期</span><kbd>双击日期格</kbd></div></Section>
              </>}
            </div>
          </div>
        </div>
        <footer className="dialog-actions"><button className="button primary" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}
