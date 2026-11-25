import { TOOLBAR_ACTIONS } from './toolbarActions';
import type { AppState, NoteImage, Settings, StickyNote, Task, TaskColor } from '../types';
import { DEFAULT_RECURRENCE, isDateKey, normalizeRecurrence, REPEAT_OPTIONS } from './recurrence';
import { isClockTime, isTaskTimeRange } from './taskTime';

const STORAGE_KEY = 'floating-agenda-state-v1';
const TASK_COLORS: TaskColor[] = ['default', 'mint', 'blue', 'amber', 'rose', 'violet'];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const DEFAULT_SETTINGS: Settings = {
  rolloverEnabled: true,
  rolloverWindow: 7,
  opacity: 52,
  backgroundColor: '#0f2634',
  showWeekNumbers: true,
  showLunar: true,
  autoNumber: true,
  cellGap: 0,
  todayColor: '#d7e9a7',
  calendarView: 'month',
  showCalendarViewSwitch: true,
  currentTimeLineColor: '#ff8d87',
  layout: 'full-month',
  maxRows: 6,
  maxColumns: 7,
  elapsedWeeks: 1,
  weekStartsOn: 1,
  weekNumberMode: 'iso',
  showTitleBar: true,
  blurEnabled: true,
  showMonthSeparator: true,
  showShadow: false,
  showLegalHolidays: true,
  showImportantFestivals: true,
  festivalRegion: 'CN',
  showSolarTerms: true,
  showYiJi: false,
  bulletStyle: 'number',
  rowGap: 2,
  completedToBottom: true,
  subtasksCompletedToBottom: true,
  rolloverHighlightEnabled: false,
  rolloverHighlightColor: '#ff6b6b',
  rolloverGhostEnabled: false,
  showCompletedTasks: true,
  showCompletedCheckbox: false,
  showCompletedIcon: false,
  showReminderTime: true,
  showTimeAxis: false,
  showWeekTimeAxis: false,
  showDayTimeAxis: false,
  taskTextBackground: 'none',
  taskAdaptiveColor: true,
  taskTextColor: '#eef6f4',
  taskBaseFontSize: 10,
  taskMinFontSize: 7,
  dayTaskBaseFontSize: 10,
  dayTaskMinFontSize: 7,
  weekTaskBaseFontSize: 10,
  weekTaskMinFontSize: 7,
  taskScrollThreshold: 6,
  editSaveSound: 'none',
  reminderSound: 'chime',
  remindersEnabled: false,
  calendarFontFamily: 'Microsoft YaHei',
  calendarFontSize: 12,
  calendarTextColor: '#eef6f4',
  editorFontFamily: 'Microsoft YaHei',
  editorFontSize: 12,
  editorTextColor: '#eef6f4',
  editorInputStyle: 'one-box',
  editorEnterSaves: true,
  showTaskDetails: true,
  taskTextStyle: 'italic-notes',
  monthTaskExtras: 'hide', weekTaskExtras: 'hide', dayTaskExtras: 'hide',
  pinnedToolbarActions: [],
  imageSkin: 'none',
  skinPosition: 'center',
  skinOpacity: 85,
  skinShade: 50,
  desktopIconLayer: 'below',
  restDayBackgroundColor: '#23382f',
  titleButtonColor: '#d7e9a7',
  festivalTextColor: '#e3b760',
  solarTermTextColor: '#72c796',
  showRestDays: true,
  restDays: [0, 6],
  showNotes: false,
  showNotesOnTaskbar: true,
  noteBulletStyle: 'number',
  noteOpacity: 20,
  noteRowGap: 2,
  noteFontFamily: 'Microsoft YaHei',
  noteFontSize: 12,
  noteTextColor: '#d8df8a',
  noteTextBackground: 'soft',
  showNoteCheckbox: false,
  showHideShortcut: 'Control+Shift+Space',
  quickCaptureShortcut: '',
  toggleContentShortcut: '',
  toggleNotesShortcut: 'Control+Alt+B',
  completeTaskShortcut: '',
  autoStartEnabled: false,
  autoCheckUpdates: false,
  language: 'zh-CN',
  proxyEnabled: false,
  proxyServer: '',
  settingsRevision: 4,
};

const BOOLEAN_KEYS = [
  'editorEnterSaves', 'showTaskDetails', 'showNotesOnTaskbar',
  'rolloverEnabled', 'rolloverHighlightEnabled', 'rolloverGhostEnabled', 'showWeekNumbers', 'showLunar', 'showTitleBar', 'blurEnabled',
  'showMonthSeparator', 'showShadow', 'showLegalHolidays', 'showImportantFestivals',
  'showSolarTerms', 'showYiJi', 'completedToBottom', 'subtasksCompletedToBottom', 'showCompletedTasks',
  'showCompletedCheckbox', 'showCompletedIcon', 'showReminderTime', 'showTimeAxis', 'showCalendarViewSwitch', 'taskAdaptiveColor',
  'remindersEnabled', 'showRestDays', 'showNotes', 'showNoteCheckbox', 'autoStartEnabled',
  'autoCheckUpdates', 'proxyEnabled',
] as const;

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function colorValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : fallback;
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function normalizeTask(value: Partial<Task>): Task | null {
  if (!value.id || !value.title || !value.date) return null;
  const cardColor = colorValue(value.cardColor, '');
  const subtasks = Array.isArray(value.subtasks) ? value.subtasks.filter(item => item && typeof item.id === 'string' && item.id
    && typeof item.title === 'string').map(item => ({ id: item.id, title: item.title, completed: item.completed === true })) : [];
  const uniqueSubtasks = [...new Map(subtasks.map(item => [item.id, item])).values()];
  return {
    id: value.id,
    title: value.title,
    notes: typeof value.notes === 'string' ? value.notes : '',
    ...(uniqueSubtasks.length ? { subtasks: uniqueSubtasks } : {}),
    date: value.date,
    time: isClockTime(value.time) ? value.time : '',
    ...(value.time && value.endTime && isTaskTimeRange(value.time, value.endTime) ? { endTime: value.endTime } : {}),
    completed: Boolean(value.completed),
    createdAt: value.createdAt ?? new Date().toISOString(),
    completedAt: value.completedAt,
    originalDate: value.originalDate ?? value.date,
    rolloverCount: value.rolloverCount ?? 0,
    ...(value.rolloverMode === 'on' || value.rolloverMode === 'off' ? { rolloverMode: value.rolloverMode } : {}),
    lastRolledFrom: value.lastRolledFrom,
    repeat: REPEAT_OPTIONS.some(option => option.value === value.repeat) ? value.repeat! : 'none',
    ...(isDateKey(value.scheduledRepeatDate) ? { scheduledRepeatDate: value.scheduledRepeatDate } : {}),
    ...(value.repeat === 'custom' ? {
      recurrence: normalizeRecurrence(value.recurrence) ?? DEFAULT_RECURRENCE,
      recurrenceStart: isDateKey(value.recurrenceStart) ? value.recurrenceStart : undefined,
      recurrenceExcludedDates: Array.isArray(value.recurrenceExcludedDates)
        ? value.recurrenceExcludedDates.filter(isDateKey) : undefined,
    } : {}),
    color: value.color && TASK_COLORS.includes(value.color) ? value.color : 'default',
    ...(cardColor ? { cardColor } : {}),
    seriesId: value.seriesId,
  };
}

function normalizeNote(value: Partial<StickyNote>): StickyNote | null {
  if (!value.id || typeof value.text !== 'string') return null;
  const validImage = (src: unknown): src is string => typeof src === 'string' && src.length <= 7_000_000
    && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
  const images: NoteImage[] = Array.isArray(value.images) ? value.images.filter(image =>
    image && typeof image.id === 'string' && validImage(image.src)) : [];
  if (validImage(value.image) && !images.some(image => image.id === value.id)) images.unshift({ id: value.id, src: value.image });
  return {
    id: value.id,
    text: value.text,
    ...(typeof value.richText === 'string' ? { richText: value.richText } : {}),
    ...(images.length ? { images } : {}),
    completed: Boolean(value.completed),
    createdAt: value.createdAt ?? new Date().toISOString(),
    open: value.open === true,
  };
}

export function normalizeAppState(value: unknown): AppState {
  if (!value || typeof value !== 'object') {
    return { tasks: [], notes: [], settings: { ...DEFAULT_SETTINGS } };
  }

  const saved = value as { tasks?: unknown; notes?: unknown; settings?: unknown };
  const tasks = Array.isArray(saved.tasks)
    ? saved.tasks.map((task) => normalizeTask(task)).filter((task): task is Task => task !== null)
    : [];
  const notes = Array.isArray(saved.notes)
    ? saved.notes.map((note) => normalizeNote(note)).filter((note): note is StickyNote => note !== null)
    : [];
  const raw = saved.settings && typeof saved.settings === 'object' ? saved.settings as Partial<Settings> & { taskNotesItalic?: unknown } : {};
  const settings = { ...DEFAULT_SETTINGS, restDays: [...DEFAULT_SETTINGS.restDays] };

  BOOLEAN_KEYS.forEach((key) => {
    if (typeof raw[key] === 'boolean') Object.assign(settings, { [key]: raw[key] });
  });

  settings.showWeekTimeAxis = typeof raw.showWeekTimeAxis === 'boolean' ? raw.showWeekTimeAxis : settings.showTimeAxis;
  settings.showDayTimeAxis = typeof raw.showDayTimeAxis === 'boolean' ? raw.showDayTimeAxis : settings.showTimeAxis;

  settings.rolloverWindow = numberInRange(raw.rolloverWindow, 1, 30, settings.rolloverWindow);
  settings.opacity = numberInRange(raw.opacity, 0, 100, settings.opacity);
  settings.cellGap = numberInRange(raw.cellGap, 0, 8, settings.cellGap);
  settings.maxRows = numberInRange(raw.maxRows, 1, 6, settings.maxRows);
  settings.maxColumns = numberInRange(raw.maxColumns, 1, 7, settings.maxColumns);
  settings.elapsedWeeks = numberInRange(raw.elapsedWeeks, 0, 5, settings.elapsedWeeks);
  settings.weekStartsOn = numberInRange(raw.weekStartsOn, 0, 6, settings.weekStartsOn);
  settings.rowGap = numberInRange(raw.rowGap, 0, 8, settings.rowGap);
  settings.taskBaseFontSize = numberInRange(raw.taskBaseFontSize, 8, 20, settings.taskBaseFontSize);
  settings.taskMinFontSize = numberInRange(raw.taskMinFontSize, 6, settings.taskBaseFontSize, settings.taskMinFontSize);
  settings.dayTaskBaseFontSize = numberInRange(raw.dayTaskBaseFontSize, 8, 20, settings.taskBaseFontSize);
  settings.dayTaskMinFontSize = numberInRange(raw.dayTaskMinFontSize, 6, settings.dayTaskBaseFontSize, Math.min(settings.taskMinFontSize, settings.dayTaskBaseFontSize));
  settings.weekTaskBaseFontSize = numberInRange(raw.weekTaskBaseFontSize, 8, 20, settings.taskBaseFontSize);
  settings.weekTaskMinFontSize = numberInRange(raw.weekTaskMinFontSize, 6, settings.weekTaskBaseFontSize, Math.min(settings.taskMinFontSize, settings.weekTaskBaseFontSize));
  settings.taskScrollThreshold = numberInRange(raw.taskScrollThreshold, 2, 30, settings.taskScrollThreshold);
  settings.calendarFontSize = numberInRange(raw.calendarFontSize, 9, 22, settings.calendarFontSize);
  settings.editorFontSize = numberInRange(raw.editorFontSize, 9, 22, settings.editorFontSize);
  settings.noteOpacity = numberInRange(raw.noteOpacity, 0, 100, settings.noteOpacity);
  settings.noteRowGap = numberInRange(raw.noteRowGap, 0, 8, settings.noteRowGap);
  settings.noteFontSize = numberInRange(raw.noteFontSize, 9, 22, settings.noteFontSize);

  settings.pinnedToolbarActions = TOOLBAR_ACTIONS.map(action => action.id).filter(id => Array.isArray(raw.pinnedToolbarActions) && raw.pinnedToolbarActions.includes(id));
  settings.taskTextStyle = enumValue(raw.taskTextStyle, ['bold-title', 'italic-notes', 'normal-notes'] as const,
    raw.taskNotesItalic === false ? 'normal-notes' : settings.taskTextStyle);
  for (const key of ['monthTaskExtras', 'weekTaskExtras', 'dayTaskExtras'] as const) {
    settings[key] = enumValue(raw[key], ['hide', 'notes', 'subtasks', 'all'] as const, settings[key]);
  }
  settings.calendarView = enumValue(raw.calendarView, ['month', 'week', 'day'] as const, settings.calendarView);
  settings.layout = enumValue(raw.layout, ['floating-month', 'full-month', 'fixed-week', 'floating-week'] as const, settings.layout);
  settings.weekNumberMode = enumValue(raw.weekNumberMode, ['iso', 'jan1'] as const, settings.weekNumberMode);
  settings.taskTextBackground = enumValue(raw.taskTextBackground, ['none', 'soft', 'solid'] as const, settings.taskTextBackground);
  settings.noteTextBackground = enumValue(raw.noteTextBackground, ['none', 'soft', 'solid'] as const, settings.noteTextBackground);
  settings.editSaveSound = enumValue(raw.editSaveSound, ['none', 'tick', 'chime'] as const, settings.editSaveSound);
  settings.reminderSound = enumValue(raw.reminderSound, ['none', 'tick', 'chime'] as const, settings.reminderSound);
  settings.calendarFontFamily = enumValue(raw.calendarFontFamily, ['Microsoft YaHei', 'Segoe UI', 'PingFang SC', 'SimSun'] as const, settings.calendarFontFamily);
  settings.editorFontFamily = enumValue(raw.editorFontFamily, ['Microsoft YaHei', 'Segoe UI', 'PingFang SC', 'SimSun'] as const, settings.editorFontFamily);
  settings.noteFontFamily = enumValue(raw.noteFontFamily, ['Microsoft YaHei', 'Segoe UI', 'PingFang SC', 'SimSun'] as const, settings.noteFontFamily);
  settings.editorInputStyle = enumValue(raw.editorInputStyle, ['one-box', 'multi-row'] as const, settings.editorInputStyle);
  settings.imageSkin = enumValue(raw.imageSkin, ['none', 'coast', 'earth', 'local'] as const, settings.imageSkin);
  settings.skinPosition = enumValue(raw.skinPosition, ['center', 'left', 'right', 'top', 'bottom'] as const, settings.skinPosition);
  settings.skinOpacity = numberInRange(raw.skinOpacity, 10, 100, settings.skinOpacity);
  settings.skinShade = numberInRange(raw.skinShade, 0, 85, settings.skinShade);
  settings.desktopIconLayer = enumValue(raw.desktopIconLayer, ['above', 'below'] as const, settings.desktopIconLayer);
  const savedRevision = typeof raw.settingsRevision === 'number' ? raw.settingsRevision : 0;
  if (savedRevision < 3 && settings.showNotes) {
    notes.forEach((note) => { note.open = true; });
  }
  settings.settingsRevision = 4;
  settings.festivalRegion = 'CN';
  settings.language = 'zh-CN';

  const legacyBullet = raw.autoNumber === false ? 'none' : settings.bulletStyle;
  settings.bulletStyle = enumValue(raw.bulletStyle, ['none', 'number', 'dot'] as const, legacyBullet);
  settings.noteBulletStyle = enumValue(raw.noteBulletStyle, ['none', 'number', 'dot'] as const, settings.noteBulletStyle);
  settings.autoNumber = settings.bulletStyle === 'number';

  settings.backgroundColor = colorValue(raw.backgroundColor, settings.backgroundColor);
  settings.todayColor = colorValue(raw.todayColor, settings.todayColor);
  settings.currentTimeLineColor = colorValue(raw.currentTimeLineColor, settings.currentTimeLineColor);
  settings.taskTextColor = colorValue(raw.taskTextColor, settings.taskTextColor);
  settings.calendarTextColor = colorValue(raw.calendarTextColor, settings.calendarTextColor);
  settings.editorTextColor = colorValue(raw.editorTextColor, settings.editorTextColor);
  settings.restDayBackgroundColor = colorValue(raw.restDayBackgroundColor, settings.restDayBackgroundColor);
  settings.titleButtonColor = colorValue(raw.titleButtonColor, settings.titleButtonColor);
  settings.festivalTextColor = colorValue(raw.festivalTextColor, settings.festivalTextColor);
  settings.solarTermTextColor = colorValue(raw.solarTermTextColor, settings.solarTermTextColor);
  settings.noteTextColor = colorValue(raw.noteTextColor, settings.noteTextColor);
  settings.rolloverHighlightColor = colorValue(raw.rolloverHighlightColor, settings.rolloverHighlightColor);

  if (Array.isArray(raw.restDays)) {
    settings.restDays = [...new Set(raw.restDays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))];
  }
  settings.showHideShortcut = textValue(raw.showHideShortcut, settings.showHideShortcut, 80).trim();
  settings.quickCaptureShortcut = textValue(raw.quickCaptureShortcut, settings.quickCaptureShortcut, 80).trim();
  settings.toggleContentShortcut = textValue(raw.toggleContentShortcut, settings.toggleContentShortcut, 80).trim();
  settings.toggleNotesShortcut = textValue(raw.toggleNotesShortcut, settings.toggleNotesShortcut, 80).trim();
  if (savedRevision < 4 && !settings.toggleNotesShortcut) settings.toggleNotesShortcut = DEFAULT_SETTINGS.toggleNotesShortcut;
  settings.completeTaskShortcut = textValue(raw.completeTaskShortcut, settings.completeTaskShortcut, 80).trim();
  settings.proxyServer = textValue(raw.proxyServer, settings.proxyServer, 300).trim();

  return { tasks, notes, settings };
}

export async function loadAppState(): Promise<AppState> {
  if (window.desktop) {
    return normalizeAppState(await window.desktop.loadState());
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  return normalizeAppState(saved ? JSON.parse(saved) : null);
}

export async function saveAppState(state: AppState): Promise<void> {
  if (window.desktop) {
    await window.desktop.saveState(state);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
