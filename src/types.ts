export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type RepeatFrequency = 'day' | 'week' | 'month' | 'year';
export type TaskRolloverMode = 'on' | 'off';
export type RepeatEnd = { type: 'never' } | { type: 'count'; count: number } | { type: 'until'; date: string };

export interface RecurrencePattern {
  frequency: RepeatFrequency;
  interval: number;
  weekdays?: number[];
  end: RepeatEnd;
}

export interface QuickTaskDraft {
  title: string;
  date: string;
  time: string;
  endTime?: string;
  repeat: RepeatRule;
  recurrence?: RecurrencePattern;
}
export type TaskColor = 'default' | 'mint' | 'blue' | 'amber' | 'rose' | 'violet';
export type CalendarView = 'month' | 'week' | 'day';
export type CalendarLayout = 'floating-month' | 'full-month' | 'fixed-week' | 'floating-week';
export type BulletStyle = 'none' | 'number' | 'dot';
export type WeekNumberMode = 'iso' | 'jan1';
export type TextBackground = 'none' | 'soft' | 'solid';
export type SoundEffect = 'none' | 'tick' | 'chime';
export type FontFamily = 'Microsoft YaHei' | 'Segoe UI' | 'PingFang SC' | 'SimSun';
export type EditorInputStyle = 'one-box' | 'multi-row';
export type ImageSkin = 'none' | 'coast' | 'earth' | 'local';
export type SkinPosition = 'center' | 'left' | 'right' | 'top' | 'bottom';
export type DesktopIconLayer = 'above' | 'below';

export interface Task {
  id: string;
  title: string;
  notes: string;
  date: string;
  time: string;
  endTime?: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
  originalDate: string;
  rolloverCount: number;
  rolloverMode?: TaskRolloverMode;
  lastRolledFrom?: string;
  repeat: RepeatRule;
  recurrence?: RecurrencePattern;
  recurrenceStart?: string;
  scheduledRepeatDate?: string;
  recurrenceExcludedDates?: string[];
  color: TaskColor;
  cardColor?: string;
  seriesId?: string;
}

export interface StickyNote {
  id: string;
  text: string;
  richText?: string;
  image?: string;
  completed: boolean;
  createdAt: string;
  open?: boolean;
}

export interface Settings {
  rolloverEnabled: boolean;
  rolloverWindow: number;
  opacity: number;
  backgroundColor: string;
  imageSkin: ImageSkin;
  skinPosition: SkinPosition;
  skinOpacity: number;
  skinShade: number;
  showWeekNumbers: boolean;
  showLunar: boolean;
  autoNumber: boolean;
  cellGap: number;
  todayColor: string;
  calendarView: CalendarView;
  showCalendarViewSwitch: boolean;
  currentTimeLineColor: string;
  layout: CalendarLayout;
  maxRows: number;
  maxColumns: number;
  elapsedWeeks: number;
  weekStartsOn: number;
  weekNumberMode: WeekNumberMode;
  showTitleBar: boolean;
  blurEnabled: boolean;
  showMonthSeparator: boolean;
  showShadow: boolean;
  showLegalHolidays: boolean;
  showImportantFestivals: boolean;
  festivalRegion: 'CN';
  showSolarTerms: boolean;
  showYiJi: boolean;
  bulletStyle: BulletStyle;
  rowGap: number;
  completedToBottom: boolean;
  rolloverHighlightEnabled: boolean;
  rolloverHighlightColor: string;
  rolloverGhostEnabled: boolean;
  showCompletedTasks: boolean;
  showCompletedCheckbox: boolean;
  showCompletedIcon: boolean;
  showReminderTime: boolean;
  showTimeAxis: boolean;
  showWeekTimeAxis: boolean;
  showDayTimeAxis: boolean;
  taskTextBackground: TextBackground;
  taskAdaptiveColor: boolean;
  taskTextColor: string;
  taskBaseFontSize: number;
  taskMinFontSize: number;
  dayTaskBaseFontSize: number;
  dayTaskMinFontSize: number;
  weekTaskBaseFontSize: number;
  weekTaskMinFontSize: number;
  taskScrollThreshold: number;
  editSaveSound: SoundEffect;
  reminderSound: SoundEffect;
  remindersEnabled: boolean;
  calendarFontFamily: FontFamily;
  calendarFontSize: number;
  calendarTextColor: string;
  editorFontFamily: FontFamily;
  editorFontSize: number;
  editorTextColor: string;
  editorInputStyle: EditorInputStyle;
  desktopIconLayer: DesktopIconLayer;
  restDayBackgroundColor: string;
  titleButtonColor: string;
  festivalTextColor: string;
  solarTermTextColor: string;
  showRestDays: boolean;
  restDays: number[];
  showNotes: boolean;
  noteBulletStyle: BulletStyle;
  noteOpacity: number;
  noteRowGap: number;
  noteFontFamily: FontFamily;
  noteFontSize: number;
  noteTextColor: string;
  noteTextBackground: TextBackground;
  showNoteCheckbox: boolean;
  showHideShortcut: string;
  quickCaptureShortcut: string;
  toggleContentShortcut: string;
  toggleNotesShortcut: string;
  completeTaskShortcut: string;
  autoStartEnabled: boolean;
  autoCheckUpdates: boolean;
  language: 'zh-CN';
  proxyEnabled: boolean;
  proxyServer: string;
  settingsRevision: number;
}

export interface AppState {
  tasks: Task[];
  notes: StickyNote[];
  settings: Settings;
}

export type WorkspaceItem = { kind: 'task'; id: string; draft: QuickTaskDraft }
  | { kind: 'image-note'; id: string; image: string };

export interface WorkspaceRequest {
  requestId: string;
  item: WorkspaceItem;
}

export interface NutstoreSyncStatus {
  configured: boolean;
  email: string;
  autoSync: boolean;
  intervalMinutes: number;
  intervalOptions: number[];
  encryptionAvailable: boolean;
  remoteLocation: string;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  remoteSavedAt: string | null;
}

export interface NutstoreRemoteSummary {
  savedAt: string | null;
  taskCount: number;
  noteCount: number;
}

export interface NutstoreSyncResult {
  ok: boolean;
  action: 'pulled' | 'pushed' | 'up-to-date' | 'conflict' | 'error' | 'not-configured' | 'disabled' | 'busy';
  message: string;
  state?: unknown;
  remote?: NutstoreRemoteSummary;
  pullId?: string;
  status: NutstoreSyncStatus;
}

export interface NutstoreConfigResult {
  ok: boolean;
  message: string;
  status: NutstoreSyncStatus;
}

export type NotesAppearance = Pick<
  Settings,
  | 'backgroundColor'
  | 'noteOpacity'
  | 'noteRowGap'
  | 'noteFontFamily'
  | 'noteFontSize'
  | 'noteTextColor'
  | 'noteTextBackground'
  | 'noteBulletStyle'
  | 'showNoteCheckbox'
>;

export type NotePatch = Partial<Pick<StickyNote, 'text' | 'richText' | 'completed'>>;
export type NoteFormat = { type: 'checkbox' | 'strike' } | { type: 'color'; color: string };

export interface NoteStatePayload {
  note: StickyNote;
  appearance: NotesAppearance;
}

export type TaskFilter = 'pending' | 'all' | 'completed';
export type DesktopMenuAction =
  | 'open-settings'
  | 'new-task'
  | 'previous-month'
  | 'next-month'
  | 'today'
  | 'toggle-content'
  | 'toggle-notes'
  | 'note:new'
  | `note:toggle:${string}`
  | 'complete-selected'
  | `filter:${TaskFilter}`
  | 'toggle:autoNumber'
  | 'toggle:showWeekNumbers'
  | 'toggle:showLunar'
  | 'toggle:rolloverEnabled'
  | 'toggle:autoStartEnabled';

export type WindowAdjustmentMode = 'move' | 'resize';
export type WindowResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface CalendarDisplayStatus {
  selected: string;
  usingFallback: boolean;
  options: { value: string; label: string }[];
}

export interface UpdateCheckResult {
  status: 'current' | 'available' | 'unavailable';
  message: string;
  url?: string;
}

export interface DesktopBridge {
  isElectron: true;
  repairDesktopInput: () => Promise<string>;
  openQuickCapture: () => Promise<void>;
  closeQuickCapture: () => Promise<void>;
  submitQuickTask: (id: string, draft: QuickTaskDraft) => Promise<void>;
  openDrawingBoard: () => Promise<void>;
  exportDrawing: (bytes: Uint8Array) => Promise<boolean>;
  saveDrawingNote: (id: string, bytes: Uint8Array) => Promise<void>;
  onWorkspaceRequest: (callback: (request: WorkspaceRequest) => void) => () => void;
  workspaceReady: () => void;
  workspaceSaved: (requestId: string, saved: boolean) => void;
  loadState: () => Promise<unknown>;
  saveState: (state: AppState) => Promise<void>;
  minimizeWindow: () => Promise<void>;
  loadThemeImage: () => Promise<string | null>;
  saveThemeImage: (bytes: Uint8Array) => Promise<string>;
  focusCalendarInput: () => Promise<void>;
  getCalendarDisplays: () => Promise<CalendarDisplayStatus>;
  setCalendarDisplay: (preference: string) => Promise<CalendarDisplayStatus>;
  onCalendarDisplays: (callback: (status: CalendarDisplayStatus) => void) => () => void;
  setWindowAdjustmentMode: (enabled: boolean) => Promise<void>;
  startWindowAdjustment: (mode: WindowAdjustmentMode, resizeEdges?: WindowResizeEdge) => Promise<void>;
  updateWindowAdjustment: () => Promise<void>;
  stopWindowAdjustment: () => Promise<void>;
  quitApp: () => Promise<void>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  syncNotes: (payload: { notes: StickyNote[]; appearance: NotesAppearance }) => void;
  showNoteFormatMenu: (id: string, x: number, y: number, hasSelection: boolean) => void;
  onNoteFormat: (callback: (format: NoteFormat) => void) => () => void;
  noteReady: (id: string) => Promise<NoteStatePayload | null>;
  sendNoteChange: (id: string, patch: NotePatch) => void;
  closeNote: (id: string) => void;
  deleteNote: (id: string) => void;
  newNote: () => void;
  focusNote: (id: string) => void;
  onNoteState: (callback: (payload: NoteStatePayload) => void) => () => void;
  onNotesPatch: (callback: (payload: { id: string; patch: Partial<StickyNote> }) => void) => () => void;
  onNotesOpenChanged: (callback: (id: string, open: boolean) => void) => () => void;
  onNotesDeleted: (callback: (id: string) => void) => () => void;
  onNotesCreate: (callback: () => void) => () => void;
  startNoteDrag: (id: string, x: number, y: number) => void;
  moveNoteDrag: (id: string) => void;
  endNoteDrag: (id: string) => void;
  resizeNoteWindow: (id: string, height: number) => void;
  syncGetStatus: () => Promise<NutstoreSyncStatus>;
  syncConnect: (payload: { email: string; appPassword: string; autoSync: boolean }) => Promise<NutstoreConfigResult>;
  syncDisconnect: () => Promise<NutstoreConfigResult>;
  syncSetAutoSync: (enabled: boolean) => Promise<NutstoreConfigResult>;
  syncSetInterval: (intervalMinutes: number) => Promise<NutstoreConfigResult>;
  syncFinishPull: (id: string, state: AppState | null) => Promise<NutstoreSyncStatus>;
  syncNow: (state: AppState, options?: { manual?: boolean; strategy?: 'local' | 'remote' }) => Promise<NutstoreSyncResult>;
  onMenuAction: (callback: (action: DesktopMenuAction) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
