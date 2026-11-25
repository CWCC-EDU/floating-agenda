import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ListChecks, LogOut, Menu, Move, Palette, PenLine, Plus, RefreshCw, Repeat2, Settings2, StickyNote as StickyNoteIcon, Zap } from 'lucide-react';
import { DayEditorDialog } from './components/DayEditorDialog';
import { NotesPanel } from './components/NotesPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { ScheduleView } from './components/ScheduleView';
import { addDays, addMonths, adjacentCalendarPage, festivalLabel, fromDateKey, fullDateLabel, getCalendarColumns, getCalendarDays, getWeekDays, getWeekNumber, lunarDateLabel, monthLabel, shortDateLabel, solarTermLabel, startOfMonth, startOfWeek, toDateKey, yiJiLabel } from './lib/date';
import { createTask, extendRecurringTasks, removeTaskSeries, rolloverTasks, sortTasks, updateDayTasks } from './lib/tasks';
import { isDateKey, normalizeRecurrence, REPEAT_OPTIONS } from './lib/recurrence';
import { isTaskTimeRange, taskTimeLabel, timeAxisSegment } from './lib/taskTime';
import { DEFAULT_SETTINGS, loadAppState, normalizeAppState, saveAppState } from './lib/storage';
import { readableTextColor, taskCardColor, taskFontSize, TASK_PALETTE } from './lib/appearance';
import { readLocalSkin, skinImage } from './lib/skins';
import { playSound } from './lib/sound';
import type { AppState, CalendarView, NutstoreRemoteSummary, NutstoreSyncResult, NutstoreSyncStatus, NotesAppearance, Settings, StickyNote, Task, TaskFilter, WindowAdjustmentMode, WindowResizeEdge, WorkspaceItem } from './types';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WINDOW_RESIZE_EDGES: WindowResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const TOP_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const CALENDAR_VIEWS: { view: CalendarView; label: string }[] = [{ view: 'day', label: '日' }, { view: 'week', label: '周' }, { view: 'month', label: '月' }];
type EditorSelection = { date: string; taskId?: string; keepViewDate?: boolean; initialTime?: Pick<Task, 'time' | 'endTime'> };
type ToggleSetting = 'autoNumber' | 'showWeekNumbers' | 'showLunar' | 'rolloverEnabled' | 'autoStartEnabled';

function newStickyNote(): StickyNote {
  return { id: crypto.randomUUID(), text: '', completed: false, createdAt: new Date().toISOString(), open: true };
}

export default function App() {
  const [today, setToday] = useState(toDateKey());
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthCursor, setMonthCursor] = useState(startOfMonth(today));
  const [monthPageStart, setMonthPageStart] = useState<string>();
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  const [localSkin, setLocalSkin] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [state, setState] = useState<AppState>({ tasks: [], notes: [], settings: DEFAULT_SETTINGS });
  const [isReady, setIsReady] = useState(false);
  const [editor, setEditor] = useState<EditorSelection | null>(null);
  const [showSettings, setShowSettings] = useState<boolean | 'notes' | 'appearance' | 'sync'>(false);
  const [showWindowMenu, setShowWindowMenu] = useState(false);
  const [showContent, setShowContent] = useState(true);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [toast, setToast] = useState('');
  const [syncStatus, setSyncStatus] = useState<NutstoreSyncStatus | null>(null);
  const [syncConflict, setSyncConflict] = useState<NutstoreRemoteSummary | null>(null);
  const syncBusy = useRef(false);
  const syncConflictNotice = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const adjustmentFrame = useRef<number | null>(null);
  const adjustmentPointer = useRef<number | null>(null);
  const notifiedTasks = useRef(new Set<string>());
  const pendingWorkspace = useRef(new Map<string, WorkspaceItem>());
  const isElectron = Boolean(window.desktop);

  useEffect(() => {
    if (!isElectron) return;
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [isElectron]);

  useEffect(() => {
    if (state.settings.imageSkin !== 'local') return;
    let active = true;
    readLocalSkin().then((image) => { if (active) setLocalSkin(image); }).catch(console.warn);
    return () => { active = false; };
  }, [state.settings.imageSkin]);

  useEffect(() => {
    let active = true;
    loadAppState().then((saved) => {
      if (!active) return;
      const todayKey = toDateKey();
      const result = rolloverTasks(saved.tasks, todayKey, saved.settings);
      const extended = extendRecurringTasks(result.tasks, todayKey);
      setState({ ...saved, tasks: extended.tasks });
      setIsReady(true);
      if (result.moved > 0) setToast(`已把 ${result.moved} 项未完成任务顺延到今天`);
    }).catch(() => {
      if (!active) return;
      setIsReady(true);
      setToast('读取本地数据失败，已打开空白清单');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const requests = [...pendingWorkspace.current].filter(([, item]) =>
      item.kind === 'task' ? state.tasks.some(task => task.id === item.id)
        : state.notes.some(note => note.id === (item.targetNoteId ?? item.id) && note.images?.some(image => image.id === item.id)));
    function acknowledge(saved: boolean) {
      for (const [requestId] of requests) {
        if (pendingWorkspace.current.delete(requestId)) window.desktop?.workspaceSaved(requestId, saved);
      }
    }
    saveAppState(state).then(() => acknowledge(true)).catch(() => {
      acknowledge(false);
      setToast('保存失败，请检查本地存储权限');
    });
  }, [state, isReady]);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop || !isReady) return;
    const dispose = desktop.onWorkspaceRequest(({ requestId, item }) => {
      if (item.kind === 'task') {
        const { draft } = item;
        const recurrence = draft.repeat === 'custom' ? normalizeRecurrence(draft.recurrence) : undefined;
        if (!isDateKey(draft.date) || !isTaskTimeRange(draft.time, draft.endTime)
          || !REPEAT_OPTIONS.some(option => option.value === draft.repeat) || (draft.repeat === 'custom' && !recurrence)
          || (recurrence?.end.type === 'until' && recurrence.end.date < draft.date)) {
          desktop.workspaceSaved(requestId, false);
          return;
        }
        pendingWorkspace.current.set(requestId, item);
        const task = createTask(draft.date, { ...draft, recurrence }, item.id);
        setState(current => current.tasks.some(existing => existing.id === item.id) ? { ...current }
          : { ...current, tasks: extendRecurringTasks([...current.tasks, task], toDateKey()).tasks });
        return;
      }
      const target = item.targetNoteId;
      if (target && !stateRef.current.notes.some(note => note.id === target)) {
        desktop.workspaceSaved(requestId, false);
        return;
      }
      pendingWorkspace.current.set(requestId, item);
      const image = { id: item.id, src: item.image };
      setState(current => {
        const noteId = target ?? item.id;
        const existing = current.notes.find(note => note.id === noteId);
        const notes = existing ? current.notes.map(note => note.id !== noteId ? note : {
          ...note, open: true,
          images: note.images?.some(attachment => attachment.id === image.id) ? note.images : [...(note.images ?? []), image],
        }) : target ? current.notes : [...current.notes, { ...newStickyNote(), id: noteId, images: [image] }];
        return { ...current, notes, settings: { ...current.settings, showNotes: true } };
      });
    });
    desktop.workspaceReady();
    return dispose;
  }, [isReady]);

  const applyRemoteState = useCallback(async (result: NutstoreSyncResult, expected: AppState): Promise<NutstoreSyncResult> => {
    const desktop = window.desktop;
    if (!desktop || result.action !== 'pulled' || !result.state || !result.pullId) return result;

    if (stateRef.current !== expected) {
      const status = await desktop.syncFinishPull(result.pullId, null);
      return { ...result, status, ok: false, action: 'conflict', message: '下载期间本机数据有改动，请选择保留哪一份' };
    }

    const normalized = normalizeAppState(result.state);
    const todayKey = toDateKey();
    const rolled = rolloverTasks(normalized.tasks, todayKey, normalized.settings);
    const extended = extendRecurringTasks(rolled.tasks, todayKey);
    const next = { ...normalized, tasks: extended.tasks };
    const persisted = desktop.syncFinishPull(result.pullId, next);
    stateRef.current = next;
    setState(next);
    const status = await persisted;
    setToast('已从坚果云同步');
    return { ...result, status };
  }, []);

  useEffect(() => {
    let active = true;
    window.desktop?.syncGetStatus().then((status) => {
      if (active) setSyncStatus(status);
    }).catch(console.warn);
    return () => { active = false; };
  }, []);

  const syncCalendar = useCallback(async (manual = false) => {
    if (!window.desktop) return;
    if (syncBusy.current) {
      if (manual) setToast('正在同步，请稍候');
      return;
    }
    syncBusy.current = true;
    if (manual) setToast('正在同步…');
    try {
      const expected = stateRef.current;
      const result = await applyRemoteState(await window.desktop.syncNow(expected, { manual }), expected);
      setSyncStatus(result.status);
      if (result.action === 'conflict') {
        setSyncConflict(result.remote ?? { savedAt: null, taskCount: 0, noteCount: 0 });
        const key = result.remote?.savedAt ?? 'conflict';
        if (manual) {
          setToast(result.message);
          setShowSettings('sync');
        } else if (syncConflictNotice.current !== key) {
          syncConflictNotice.current = key;
          setToast('坚果云上有另一份日历，请到 设置 → 同步 选择保留哪一份');
        }
      } else {
        if (result.ok) {
          setSyncConflict(null);
          syncConflictNotice.current = '';
        }
        if (manual) {
          if (result.action !== 'pulled') setToast(result.message);
          if (result.action === 'not-configured') setShowSettings('sync');
        }
      }
    } catch {
      if (manual) setToast('同步失败，请稍后重试');
    } finally {
      syncBusy.current = false;
    }
  }, [applyRemoteState]);

  const autoSync = Boolean(syncStatus?.configured && syncStatus.autoSync);
  const syncIntervalMinutes = syncStatus?.intervalMinutes ?? 5;

  useEffect(() => {
    if (!autoSync || !isReady || showSettings || editor) return;
    const timer = window.setTimeout(() => { void syncCalendar(); }, 8000);
    return () => window.clearTimeout(timer);
  }, [autoSync, editor, isReady, showSettings, state, syncCalendar]);

  useEffect(() => {
    if (!autoSync || !isReady || showSettings || editor) return;
    const timer = window.setInterval(() => { void syncCalendar(); }, syncIntervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [autoSync, editor, isReady, showSettings, syncCalendar, syncIntervalMinutes]);

  const createNote = useCallback(() => {
    const note = newStickyNote();
    setShowWindowMenu(false);
    setShowSettings(false);
    window.desktop?.focusNote(note.id);
    setState((current) => ({
      ...current,
      settings: { ...current.settings, showNotes: true },
      notes: [...current.notes, note],
    }));
  }, []);

  const notesAppearance = useMemo<NotesAppearance>(() => ({
    backgroundColor: state.settings.backgroundColor,
    noteOpacity: state.settings.noteOpacity,
    noteRowGap: state.settings.noteRowGap,
    noteFontFamily: state.settings.noteFontFamily,
    noteFontSize: state.settings.noteFontSize,
    noteTextColor: state.settings.noteTextColor,
    noteTextBackground: state.settings.noteTextBackground,
    noteBulletStyle: state.settings.noteBulletStyle,
    showNoteCheckbox: state.settings.showNoteCheckbox,
  }), [
    state.settings.backgroundColor,
    state.settings.noteOpacity,
    state.settings.noteRowGap,
    state.settings.noteFontFamily,
    state.settings.noteFontSize,
    state.settings.noteTextColor,
    state.settings.noteTextBackground,
    state.settings.noteBulletStyle,
    state.settings.showNoteCheckbox,
  ]);

  useEffect(() => {
    if (!isElectron || !isReady) return;
    window.desktop?.syncNotes({ notes: state.notes, appearance: notesAppearance });
  }, [isElectron, isReady, notesAppearance, state.notes]);

  useEffect(() => {
    if (!isElectron) return;
    const offPatch = window.desktop?.onNotesPatch(({ id, patch }) => {
      setState((current) => ({
        ...current,
        notes: current.notes.map((note) => note.id === id ? { ...note, ...patch } : note),
      }));
    });
    const offOpen = window.desktop?.onNotesOpenChanged((id, open) => {
      setState((current) => ({
        ...current,
        notes: current.notes.map((note) => note.id === id ? { ...note, open } : note),
      }));
    });
    const offDeleted = window.desktop?.onNotesDeleted((id) => {
      setState((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }));
    });
    const offCreate = window.desktop?.onNotesCreate(createNote);
    return () => {
      offPatch?.();
      offOpen?.();
      offDeleted?.();
      offCreate?.();
    };
  }, [createNote, isElectron]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const checkDate = () => {
      const nextToday = toDateKey();
      if (nextToday === today) return;
      setToday(nextToday);
      setSelectedDate(nextToday);
      setMonthCursor(startOfMonth(nextToday));
      setMonthPageStart(undefined);
      notifiedTasks.current.clear();
      setState((current) => {
        const result = rolloverTasks(current.tasks, nextToday, current.settings);
        const extended = extendRecurringTasks(result.tasks, nextToday);
        if (result.moved > 0) setToast(`新的一天，已顺延 ${result.moved} 项未完成任务`);
        return { ...current, tasks: extended.tasks };
      });
    };
    const timer = window.setInterval(checkDate, 30_000);
    window.addEventListener('focus', checkDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkDate);
    };
  }, [today]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditor(null);
        setShowSettings(false);
        setShowWindowMenu(false);
        setIsAdjusting(false);
        void window.desktop?.setWindowAdjustmentMode(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setShowSettings(false);
        setEditor({ date: selectedDate });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDate]);

  useEffect(() => {
    if (!isReady || !state.settings.remindersEnabled) return;
    const checkReminders = () => {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      state.tasks.filter((task) => task.date === today && task.time === time && !task.completed).forEach((task) => {
        const key = `${task.id}:${task.date}:${task.time}`;
        if (notifiedTasks.current.has(key)) return;
        notifiedTasks.current.add(key);
        if ('Notification' in window && Notification.permission === 'granted') new Notification('日程提醒', { body: task.title });
        playSound(state.settings.reminderSound);
        setToast(`提醒：${task.title}`);
      });
    };
    checkReminders();
    const timer = window.setInterval(checkReminders, 15_000);
    return () => window.clearInterval(timer);
  }, [isReady, state.tasks, state.settings.remindersEnabled, state.settings.reminderSound, today]);

  const calendarView = state.settings.calendarView;
  const fullMonth = state.settings.layout === 'full-month';
  const calendarDays = useMemo(() => getCalendarDays(monthCursor, {
    layout: state.settings.layout,
    maxRows: state.settings.maxRows,
    maxColumns: state.settings.maxColumns,
    elapsedWeeks: state.settings.elapsedWeeks,
    weekStartsOn: state.settings.weekStartsOn,
    today,
    selectedDate,
    firstWeek: monthPageStart,
  }), [monthCursor, monthPageStart, selectedDate, state.settings.layout, state.settings.maxRows, state.settings.maxColumns, state.settings.elapsedWeeks, state.settings.weekStartsOn, today]);

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    state.tasks.forEach((task) => {
      const tasks = grouped.get(task.date) ?? [];
      tasks.push(task);
      grouped.set(task.date, tasks);
    });
    return grouped;
  }, [state.tasks]);

  const ghostTasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    if (!state.settings.rolloverEnabled || !state.settings.rolloverGhostEnabled) return grouped;
    state.tasks.forEach((task) => {
      if (task.completed || task.rolloverCount <= 0) return;
      const original = task.originalDate || task.date;
      if (!original || original === task.date) return;
      const tasks = grouped.get(original) ?? [];
      tasks.push(task);
      grouped.set(original, tasks);
    });
    return grouped;
  }, [state.settings.rolloverEnabled, state.settings.rolloverGhostEnabled, state.tasks]);

  const columnCount = getCalendarColumns(state.settings.layout, state.settings.maxColumns);
  const weekdays = useMemo(() => Array.from({ length: columnCount }, (_, index) => WEEKDAYS[(state.settings.weekStartsOn + index) % 7]), [columnCount, state.settings.weekStartsOn]);
  const rowCount = Math.ceil(calendarDays.length / columnCount);
  const scheduleDates = useMemo(() => calendarView === 'week' ? getWeekDays(selectedDate, state.settings.weekStartsOn) : [selectedDate],
    [calendarView, selectedDate, state.settings.weekStartsOn]);
  function pageDateRange(dates: string[]) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    const firstYear = first.slice(0, 4);
    const lastYear = last.slice(0, 4);
    return firstYear + '年' + shortDateLabel(first) + ' – ' + (lastYear === firstYear ? '' : lastYear + '年') + shortDateLabel(last);
  }
  const periodLabel = calendarView === 'day' ? TOP_DATE_FORMATTER.format(fromDateKey(selectedDate))
    : calendarView === 'week' ? pageDateRange(scheduleDates) : fullMonth ? monthLabel(monthCursor) : pageDateRange(calendarDays);
  const navigationUnit = calendarView === 'day' ? '一天' : calendarView === 'week' ? '一周' : fullMonth ? '个月' : '一页';
  const defaultTaskColor = readableTextColor(state.settings.backgroundColor, state.settings.taskTextColor, state.settings.taskAdaptiveColor);

  function matchesFilter(task: Task) {
    if (!state.settings.showCompletedTasks && task.completed) return false;
    if (filter === 'pending') return !task.completed;
    if (filter === 'completed') return task.completed;
    return true;
  }

  function updateSettings(settings: Settings) {
    if (settings.layout !== state.settings.layout) setMonthPageStart(undefined);
    if (settings.calendarView === 'month' && calendarView !== 'month' && !calendarDays.includes(selectedDate)) {
      setMonthLocation(selectedDate, settings.layout);
    }
    if (settings.remindersEnabled && !state.settings.remindersEnabled && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    setState((current) => {
      const result = rolloverTasks(current.tasks, today, settings);
      if (result.moved > 0) setToast(`已把 ${result.moved} 项未完成任务顺延到今天`);
      return { ...current, tasks: result.tasks, settings };
    });
  }

  function toggleSetting(key: ToggleSetting) {
    setState((current) => {
      const enabled = !current.settings[key];
      const settings = { ...current.settings, [key]: enabled };
      if (key === 'autoNumber') settings.bulletStyle = enabled ? 'number' : 'none';
      const result = rolloverTasks(current.tasks, today, settings);
      if (result.moved > 0) setToast(`已把 ${result.moved} 项未完成任务顺延到今天`);
      return { ...current, tasks: result.tasks, settings };
    });
  }

  function setMonthLocation(date: string, layout = state.settings.layout) {
    setMonthCursor(startOfMonth(date));
    setMonthPageStart(date === today || layout === 'full-month' ? undefined : startOfWeek(date, state.settings.weekStartsOn));
  }

  function goToDate(date: string) {
    setSelectedDate(date);
    setMonthLocation(date);
  }

  function goToToday() {
    goToDate(today);
    if (state.settings.layout === 'fixed-week') setMonthPageStart(startOfWeek(today, state.settings.weekStartsOn));
  }

  function navigatePeriod(direction: -1 | 1) {
    if (calendarView === 'day' || calendarView === 'week') {
      const step = direction * (calendarView === 'week' ? 7 : 1);
      setSelectedDate(date => addDays(date, step));
      return;
    }
    if (fullMonth) {
      const month = addMonths(monthCursor, direction);
      setMonthCursor(month);
      setSelectedDate(month);
    } else {
      const first = adjacentCalendarPage(calendarDays[0], rowCount, direction);
      setMonthPageStart(first);
      setMonthCursor(startOfMonth(first));
      setSelectedDate(first);
    }
  }

  function switchCalendarView(view: CalendarView) {
    if (view === calendarView) return;
    if (view === 'month' && !calendarDays.includes(selectedDate)) setMonthLocation(selectedDate);
    setState(current => ({ ...current, settings: { ...current.settings, calendarView: view } }));
  }

  function openNote(id: string) {
    setShowWindowMenu(false);
    setShowSettings(false);
    setState((current) => ({
      ...current,
      settings: { ...current.settings, showNotes: true },
      notes: current.notes.map((note) => note.id === id ? { ...note, open: true } : note),
    }));
    void window.desktop?.focusNote(id);
  }

  function destroyNote(id: string) {
    if (window.desktop) {
      window.desktop.deleteNote(id);
    } else {
      setState((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }));
    }
  }

  function toggleNoteOpen(id: string) {
    setState((current) => ({
      ...current,
      notes: current.notes.map((note) => note.id === id ? { ...note, open: !note.open } : note),
    }));
  }

  function toggleNotesVisibility() {
    setState((current) => {
      if (current.notes.length === 0) {
        return { ...current, settings: { ...current.settings, showNotes: true }, notes: [newStickyNote()] };
      }
      const anyOpen = current.notes.some((note) => note.open);
      if (anyOpen) {
        return {
          ...current,
          settings: { ...current.settings, showNotes: false },
          notes: current.notes.map((note) => ({ ...note, open: false })),
        };
      }
      const latest = [...current.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        ...current,
        settings: { ...current.settings, showNotes: true },
        notes: current.notes.map((note) => note.id === latest.id ? { ...note, open: true } : note),
      };
    });
  }

  function saveDayTasks(date: string, editedTasks: Task[], managed: ReadonlySet<string>, close = true) {
    setState((current) => {
      const tasks = updateDayTasks(current.tasks, date, sortTasks(editedTasks, current.settings.completedToBottom), managed, today);
      const enabled = new Set(editedTasks.filter(task => task.rolloverMode === 'on').map(task => task.id));
      return { ...current, tasks: enabled.size ? rolloverTasks(tasks, today, current.settings, enabled).tasks : tasks };
    });
    if (!editor?.keepViewDate) {
      setSelectedDate(date);
      if (calendarView === 'month' && !calendarDays.includes(date)) setMonthLocation(date);
    }
    if (!close) return;
    setEditor(null);
    playSound(state.settings.editSaveSound);
    setToast('当天日程已保存');
  }

  function cancelTaskSeries(taskId: string) {
    const target = state.tasks.find((task) => task.id === taskId);
    const seriesId = target?.seriesId ?? (target && target.repeat !== 'none' ? target.id : undefined);
    if (!seriesId) return;
    setState((current) => ({ ...current, tasks: removeTaskSeries(current.tasks, seriesId) }));
    setToast('已删除该重复任务的全部日程');
  }

  const setTaskCompletion = useCallback((id: string, completed: boolean) => {
    setState(current => ({ ...current, tasks: current.tasks.map(task => task.id === id && task.completed !== completed
      ? { ...task, completed, completedAt: completed ? new Date().toISOString() : undefined } : task) }));
    playSound(state.settings.editSaveSound);
  }, [state.settings.editSaveSound]);

  useEffect(() => window.desktop?.onTaskMenuComplete(({ id, editing, completed }) => {
    if (!editing) setTaskCompletion(id, completed);
  }), [setTaskCompletion]);

  function toggleTaskCompletion(task: Task) {
    setTaskCompletion(task.id, !task.completed);
  }

  function openTaskMenu(task: Task, event: MouseEvent<HTMLElement>) {
    if (!window.desktop) return;
    event.preventDefault();
    event.stopPropagation();
    window.desktop.showTaskMenu({ id: task.id, x: event.clientX, y: event.clientY, editing: false, completed: task.completed });
  }

  function completeSelectedTask() {
    const task = sortTasks((tasksByDate.get(selectedDate) ?? []).filter((item) => !item.completed), state.settings.completedToBottom)[0];
    if (task) toggleTaskCompletion(task);
    else setToast('选中日期没有待完成任务');
  }

  function goToTask(task: Task, displayedDate = task.date) {
    setSelectedDate(displayedDate);
    if (calendarView === 'month' && !calendarDays.includes(task.date)) setMonthLocation(task.date);
    setEditor({ date: task.date, taskId: task.id, keepViewDate: displayedDate !== task.date });
  }

  function getDayTasks(date: string) {
    return sortTasks((tasksByDate.get(date) ?? []).filter(matchesFilter), state.settings.completedToBottom);
  }

  function getGhostTasks(date: string) {
    return filter === 'completed' ? [] : (ghostTasksByDate.get(date) ?? []);
  }

  function taskColor(task: Task) {
    const rolledOver = state.settings.rolloverEnabled && state.settings.rolloverHighlightEnabled && !task.completed && task.rolloverCount > 0;
    return rolledOver ? state.settings.rolloverHighlightColor : task.color === 'default' ? defaultTaskColor : TASK_PALETTE[task.color];
  }

  function renderTask(task: Task, taskIndex: number, showNumber = true) {
    const rolledOver = state.settings.rolloverEnabled && state.settings.rolloverHighlightEnabled && !task.completed && task.rolloverCount > 0;
    const background = calendarView === 'month' ? undefined : taskCardColor(task);
    const color = background ? readableTextColor(background, defaultTaskColor, true) : taskColor(task);
    const style = { '--task-item-color': color, '--task-card-background': background } as CSSProperties;
    return (
      <div className={`calendar-task ${task.completed ? 'is-completed' : ''} ${rolledOver ? 'is-rolled-over' : ''}`} data-color={task.color} data-background={state.settings.taskTextBackground} data-rollover={rolledOver ? 'true' : undefined} data-card-color={background ? 'true' : undefined} style={style} key={task.id} onContextMenu={event => openTaskMenu(task, event)}>
        {state.settings.showCompletedCheckbox && <input className="task-checkbox" type="checkbox" aria-label={`完成 ${task.title}`} checked={task.completed} onClick={(event) => event.stopPropagation()} onChange={() => toggleTaskCompletion(task)} />}
        <button className="calendar-task-label" type="button" title={`${task.time ? `${taskTimeLabel(task.time, task.endTime)} ` : ''}${task.title}${rolledOver ? ` · 已顺延 ${task.rolloverCount} 次` : ''}`} onClick={(event) => { event.stopPropagation(); goToTask(task); }}>
          {showNumber && state.settings.bulletStyle !== 'none' && <span className="task-number">{state.settings.bulletStyle === 'number' ? `${taskIndex + 1}.` : '•'}</span>}
          <span className="task-title">{task.title}</span>
          {state.settings.showReminderTime && task.time && <span className="task-time">{taskTimeLabel(task.time, task.endTime)}</span>}
          {task.completed && state.settings.showCompletedIcon && <Check className="task-complete-icon" size={11} />}
          {task.repeat !== 'none' && <span className="task-indicators"><Repeat2 className="task-repeat" size={10} /></span>}
        </button>
      </div>
    );
  }

  function renderGhostTask(task: Task) {
    return (
      <div className="calendar-task is-rollover-ghost" data-background={state.settings.taskTextBackground} style={{ '--task-item-color': state.settings.rolloverHighlightEnabled ? state.settings.rolloverHighlightColor : defaultTaskColor } as CSSProperties} key={`ghost-${task.id}`}>
        <button className="calendar-task-label" type="button" title={`「${task.title}」原定 ${shortDateLabel(task.originalDate || task.date)}，已顺延到 ${shortDateLabel(task.date)}，点击打开`} onClick={(event) => {
          event.stopPropagation();
          goToTask(task);
        }}>
          <span className="task-number">↷</span>
          <span className="task-title">{task.title}</span>
          <span className="task-rollover-badge">顺延</span>
        </button>
      </div>
    );
  }

  function addFromDoubleClick(event: MouseEvent<HTMLDivElement>, date: string) {
    if ((event.target as HTMLElement).closest('button,input')) return;
    setEditor({ date });
  }

  function toggleAdjustmentMode() {
    const enabled = !isAdjusting;
    void window.desktop?.setWindowAdjustmentMode(enabled);
    setIsAdjusting(enabled);
    setShowWindowMenu(false);
  }

  function startWindowAdjustment(event: PointerEvent<HTMLElement>, mode: WindowAdjustmentMode, resizeEdges: WindowResizeEdge = 'se') {
    if (!isAdjusting || event.button !== 0 || !window.desktop) return;
    if (mode === 'move' && (event.target as HTMLElement).closest('button,input')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    adjustmentPointer.current = event.pointerId;
    void window.desktop.startWindowAdjustment(mode, resizeEdges);
  }

  function updateWindowAdjustment(event: PointerEvent<HTMLElement>) {
    if (adjustmentPointer.current !== event.pointerId || adjustmentFrame.current !== null) return;
    adjustmentFrame.current = requestAnimationFrame(() => {
      adjustmentFrame.current = null;
      if (adjustmentPointer.current !== null) void window.desktop?.updateWindowAdjustment();
    });
  }

  function stopWindowAdjustment(event: PointerEvent<HTMLElement>) {
    if (adjustmentPointer.current !== event.pointerId) return;
    adjustmentPointer.current = null;
    if (adjustmentFrame.current !== null) {
      cancelAnimationFrame(adjustmentFrame.current);
      adjustmentFrame.current = null;
    }
    if (event.type === 'pointerup') void window.desktop?.updateWindowAdjustment();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    void window.desktop?.stopWindowAdjustment();
  }

  function openSettingsFromMenu() {
    setShowWindowMenu(false);
    setEditor(null);
    setShowSettings(true);
  }

  useEffect(() => {
    return window.desktop?.onMenuAction((action) => {
      if (action === 'open-settings') {
        setEditor(null);
        setShowSettings(true);
      } else if (action === 'new-task') {
        setShowSettings(false);
        setEditor({ date: selectedDate });
      } else if (action === 'previous-month') {
        navigatePeriod(-1);
      } else if (action === 'next-month') {
        navigatePeriod(1);
      } else if (action === 'today') {
        goToToday();
      } else if (action === 'toggle-content') {
        setShowContent((current) => !current);
      } else if (action === 'toggle-notes') {
        toggleNotesVisibility();
      } else if (action === 'note:new') {
        createNote();
      } else if (action.startsWith('note:toggle:')) {
        toggleNoteOpen(action.slice(12));
      } else if (action === 'complete-selected') {
        completeSelectedTask();
      } else if (action.startsWith('filter:')) {
        setFilter(action.slice(7) as TaskFilter);
      } else if (action.startsWith('toggle:')) {
        toggleSetting(action.slice(7) as ToggleSetting);
      }
    });
  }, [selectedDate, today, state.tasks, state.settings, monthCursor, calendarDays]);

  const skin = skinImage(state.settings.imageSkin, localSkin);
  const backgroundAlpha = Math.round(state.settings.opacity / 100 * 255).toString(16).padStart(2, '0');
  const appStyle = {
    '--calendar-background': `${state.settings.backgroundColor}${backgroundAlpha}`,
    '--cell-gap': `${state.settings.cellGap}px`,
    '--today-color': state.settings.todayColor,
    '--calendar-font-family': state.settings.calendarFontFamily,
    '--calendar-font-size': `${state.settings.calendarFontSize}px`,
    '--calendar-text-color': state.settings.calendarTextColor,
    '--task-color': defaultTaskColor,
    '--rollover-accent': state.settings.rolloverHighlightColor,
    '--row-gap': `${state.settings.rowGap}px`,
    '--rest-day-background': `${state.settings.restDayBackgroundColor}66`,
    '--title-button-color': state.settings.titleButtonColor,
    '--festival-color': state.settings.festivalTextColor,
    '--solar-term-color': state.settings.solarTermTextColor,
    '--calendar-columns': columnCount,
    '--calendar-rows': rowCount,
    '--topbar-height': state.settings.showTitleBar ? '32px' : '0px',
  } as CSSProperties;

  return (
    <main className={`desktop-canvas ${isElectron ? (windowFocused ? 'is-electron has-focus' : 'is-electron') : 'is-web'}`}>
      <section className={`calendar-shell ${isAdjusting ? 'is-adjusting' : ''} ${state.settings.blurEnabled && !skin ? '' : 'no-blur'} ${state.settings.showShadow ? 'with-shadow' : ''} ${showContent ? '' : 'content-hidden'} ${state.settings.showTitleBar ? '' : 'no-titlebar'}`} style={appStyle} aria-label="浮屿桌面日历">
        {skin && <div className="calendar-skin" aria-hidden="true" style={{
          backgroundImage: `linear-gradient(rgb(7 19 32 / ${state.settings.skinShade}%), rgb(7 19 32 / ${state.settings.skinShade}%)), url(${JSON.stringify(skin)})`,
          backgroundPosition: state.settings.skinPosition,
          opacity: state.settings.skinOpacity / 100,
        }} />}
        {state.settings.showTitleBar && <header className="calendar-topbar" onPointerDown={(event) => startWindowAdjustment(event, 'move')} onPointerMove={updateWindowAdjustment} onPointerUp={stopWindowAdjustment} onPointerCancel={stopWindowAdjustment}>
          {state.settings.showCalendarViewSwitch && <div className="calendar-view-switch" role="group" aria-label="日历视图">
            {CALENDAR_VIEWS.map(({ view, label }) => (
              <button key={view} type="button" aria-label={label + '视图'} aria-pressed={calendarView === view} onClick={() => switchCalendarView(view)}>{label}</button>
            ))}
          </div>}
          <div className="topbar-month-nav">
            <button type="button" className="topbar-arrow" aria-label={'上' + navigationUnit} title={'上' + navigationUnit} onClick={() => navigatePeriod(-1)}><ChevronLeft size={13} /></button>
            <div className="topbar-date" aria-live="polite">{periodLabel}</div>
            <button type="button" className="topbar-arrow" aria-label={'下' + navigationUnit} title={'下' + navigationUnit} onClick={() => navigatePeriod(1)}><ChevronRight size={13} /></button>
          </div>
          <div className="window-controls">
            <button type="button" aria-label="打开功能菜单" title="功能菜单" aria-expanded={showWindowMenu} onClick={() => setShowWindowMenu((current) => !current)}><Menu size={17} /></button>
          </div>
        </header>}

        {showWindowMenu && <>
          <div className="window-menu-backdrop" aria-hidden="true" onPointerDown={() => setShowWindowMenu(false)} />
          <div className="window-function-menu" role="menu" aria-label="日历功能">
            <button type="button" role="menuitem" onClick={() => { goToToday(); setShowWindowMenu(false); }}><CalendarDays size={15} /><span>回到今天</span></button>
            <label className="window-menu-date"><CalendarDays size={15} /><span>选择日期</span><input type={calendarView === 'month' && fullMonth ? 'month' : 'date'} aria-label={calendarView === 'month' && fullMonth ? '选择月份' : '选择日期'} value={calendarView === 'month' && fullMonth ? monthCursor.slice(0, 7) : selectedDate} onChange={(event) => { if (event.target.value) goToDate(event.target.value.length === 7 ? event.target.value + '-01' : event.target.value); }} /></label>
            <button type="button" role="menuitem" onClick={() => { setShowWindowMenu(false); setShowSettings('appearance'); }}><Palette size={15} /><span>主题皮肤</span></button>
            {isElectron && <button type="button" role="menuitem" onClick={() => { setShowWindowMenu(false); void window.desktop?.openQuickCapture(); }}><Zap size={15} /><span>快速记一条</span></button>}
            {isElectron && <button type="button" role="menuitem" onClick={() => { setShowWindowMenu(false); void window.desktop?.openDrawingBoard(); }}><PenLine size={15} /><span>小画板</span></button>}
            <div className="window-menu-notes">
              <button type="button" role="menuitem" onClick={createNote}><Plus size={15} /><span>新建便签</span></button>
              <button type="button" role="menuitem" onClick={() => { setShowWindowMenu(false); setShowSettings('notes'); }}><StickyNoteIcon size={15} /><span>管理便签</span></button>
            </div>
            <button type="button" role="menuitem" className={isAdjusting ? 'is-active' : ''} disabled={!isElectron} onClick={toggleAdjustmentMode}><Move size={15} /><span>{isAdjusting ? '完成位置和大小调整' : '调整位置和大小'}</span>{isAdjusting && <Check size={14} />}</button>
            <button type="button" role="menuitem" disabled={!isElectron} onClick={() => { setShowWindowMenu(false); void window.desktop?.minimizeWindow(); }}><ChevronDown size={15} /><span>隐藏日历清单</span></button>
            <div className="window-menu-separator" />
            {isElectron && <button type="button" role="menuitem" disabled={!isReady} onClick={() => { setShowWindowMenu(false); void syncCalendar(true); }}><RefreshCw size={15} /><span>立即同步</span></button>}
            <button type="button" role="menuitem" onClick={openSettingsFromMenu}><Settings2 size={15} /><span>日历设置</span></button>
            <button type="button" role="menuitem" disabled={!isElectron} onClick={() => void window.desktop?.quitApp()}><LogOut size={15} /><span>退出软件</span></button>
          </div>
        </>}

        {isReady && showContent && (calendarView === 'month' ? <>
          <div className={`weekday-grid ${state.settings.showWeekNumbers ? 'has-week-numbers' : ''}`}>
            {state.settings.showWeekNumbers && <span className="week-number-heading">周</span>}
            {weekdays.map((weekday, index) => <span className={state.settings.restDays.includes(fromDateKey(calendarDays[index] ?? today).getDay()) ? 'is-weekend' : ''} key={`${weekday}-${index}`}>{weekday}</span>)}
          </div>

          <div className={`calendar-grid ${state.settings.showWeekNumbers ? 'has-week-numbers' : ''} ${state.settings.showMonthSeparator ? 'has-month-separator' : ''}`} role="grid" aria-label={periodLabel + '日程'}>
            {calendarDays.map((date, index) => {
              const day = fromDateKey(date);
              const isCurrentMonth = !fullMonth || startOfMonth(date) === monthCursor;
              const dayTasks = getDayTasks(date);
              const allDayTasks = state.settings.showTimeAxis ? dayTasks.filter(task => !task.time) : [];
              const timedTasks = state.settings.showTimeAxis ? dayTasks.filter(task => task.time) : dayTasks;
              const axisTasks = state.settings.showTimeAxis
                ? [...timedTasks, ...(tasksByDate.get(addDays(date, -1)) ?? []).filter(matchesFilter)]
                  .flatMap(task => {
                    const segment = timeAxisSegment(task.time, task.endTime, task.date !== date);
                    return segment ? [{ task, ...segment }] : [];
                  })
                : [];
              const ghostTasks = getGhostTasks(date);
              const rowCountForDay = dayTasks.length + ghostTasks.length;
              const festival = festivalLabel(date, state.settings);
              const solarTerm = state.settings.showSolarTerms ? solarTermLabel(date) : '';
              const secondaryLabel = festival || solarTerm || (state.settings.showLunar ? lunarDateLabel(date) : '');
              const isRestDay = state.settings.showRestDays && state.settings.restDays.includes(day.getDay());
              const fontSize = taskFontSize(rowCountForDay, state.settings.taskBaseFontSize, state.settings.taskMinFontSize, state.settings.taskScrollThreshold);
              return (
                <Fragment key={date}>
                  {state.settings.showWeekNumbers && index % columnCount === 0 && <div className={`week-number-cell ${index >= calendarDays.length - columnCount ? 'is-last-row' : ''}`}>{getWeekNumber(date, state.settings.weekNumberMode)}</div>}
                  <div
                    className={`day-cell ${isCurrentMonth ? '' : 'is-other-month'} ${date === today ? 'is-today' : ''} ${date === selectedDate ? 'is-selected' : ''} ${isRestDay ? 'is-weekend' : ''} ${index % columnCount === columnCount - 1 ? 'is-last-column' : ''} ${index >= calendarDays.length - columnCount ? 'is-last-row' : ''}`}
                    role="gridcell"
                    data-date={date}
                    aria-selected={date === selectedDate}
                    aria-label={`${fullDateLabel(date)}，${rowCountForDay} 项日程`}
                    onClick={() => setSelectedDate(date)}
                    onDoubleClick={(event) => addFromDoubleClick(event, date)}
                  >
                    <div className="day-cell-header">
                      <span className="day-number">{day.getDate()}</span>
                      {secondaryLabel && <span className={`lunar-label ${festival ? 'is-festival' : ''} ${!festival && solarTerm ? 'is-solar-term' : ''}`} title={state.settings.showYiJi ? yiJiLabel(date) : secondaryLabel}>{secondaryLabel}</span>}
                      <button className="day-add" type="button" aria-label={`在 ${shortDateLabel(date)} 添加日程`} title="添加日程" onClick={(event) => { event.stopPropagation(); setEditor({ date }); }}><Plus size={13} /></button>
                    </div>

                    <div className={`day-tasks ${rowCountForDay > state.settings.taskScrollThreshold ? 'is-scrollable' : ''}`} style={{ '--task-font-size': `${fontSize}px` } as CSSProperties}>
                      {allDayTasks.length > 0 && <div className="day-task-group all-day-tasks" role="group" aria-label="全天">
                        <span className="all-day-label" aria-hidden="true">全天</span>
                        {allDayTasks.map((task, index) => renderTask(task, index))}
                      </div>}
                      {axisTasks.length > 0 ? <div className="day-task-group timed-tasks">
                        <div className="day-time-axis" aria-hidden="true">
                          {axisTasks.map(({ task, from, to }) => <span key={task.id} style={{
                            top: `${from / 14.4}%`, height: `max(2px, ${(to - from) / 14.4}%)`,
                            backgroundColor: task.color === 'default' ? defaultTaskColor : TASK_PALETTE[task.color],
                            opacity: task.completed ? 0.4 : 1,
                          }} />)}
                        </div>
                        {timedTasks.map((task, index) => renderTask(task, allDayTasks.length + index))}
                      </div> : timedTasks.map((task, index) => renderTask(task, index))}
                      {ghostTasks.map(renderGhostTask)}
                      {rowCountForDay === 0 && axisTasks.length === 0 && <span className="double-click-hint">双击添加</span>}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </> : <ScheduleView
          view={calendarView} dates={scheduleDates} today={today} selectedDate={selectedDate} settings={state.settings}
          getDayTasks={getDayTasks} getGhostTasks={getGhostTasks}
          renderTask={(task, index) => renderTask(task, index, false)} renderGhostTask={renderGhostTask} taskColor={taskColor}
          onSelectDate={setSelectedDate} onOpenTask={goToTask} onTaskMenu={openTaskMenu} onCreate={(date, initialTime) => {
            setSelectedDate(date);
            setEditor({ date, initialTime });
          }}
        />)}

        {state.settings.showNotes && !isElectron && <NotesPanel notes={state.notes} settings={state.settings} onChange={(notes) => setState((current) => ({ ...current, notes }))} onClose={() => setState((current) => ({ ...current, settings: { ...current.settings, showNotes: false } }))} />}

        {isAdjusting && <>
          <div className="adjustment-guard" aria-hidden="true" />
          {!state.settings.showTitleBar && <div className="adjustment-move-edge" aria-label="拖动移动日历" onPointerDown={(event) => startWindowAdjustment(event, 'move')} onPointerMove={updateWindowAdjustment} onPointerUp={stopWindowAdjustment} onPointerCancel={stopWindowAdjustment} />}
          {WINDOW_RESIZE_EDGES.map((edge) => <div key={edge} className={`adjustment-border adjustment-border-${edge}`} aria-hidden="true" onPointerDown={(event) => startWindowAdjustment(event, 'resize', edge)} onPointerMove={updateWindowAdjustment} onPointerUp={stopWindowAdjustment} onPointerCancel={stopWindowAdjustment} />)}
          <div className="adjustment-status">{state.settings.showTitleBar ? '拖动标题栏移动' : '拖动顶部移动'} · 拖动最外侧边缘调整大小 · 从右上角菜单退出</div>
        </>}

        {!isReady && <div className="loading-cover"><span /><p>正在整理你的日历…</p></div>}
        {editor && <DayEditorDialog key={editor.date + (editor.taskId ?? '')} date={editor.date} tasks={tasksByDate.get(editor.date) ?? []} initialTaskId={editor.taskId} initialTime={editor.initialTime} settings={state.settings} onAutoSave={(tasks, managed) => saveDayTasks(editor.date, tasks, managed, false)} onSave={(tasks, managed) => saveDayTasks(editor.date, tasks, managed)} onCancelSeries={cancelTaskSeries} onClose={() => setEditor(null)} />}
        {showSettings && <SettingsDialog initialCategory={showSettings === true ? 'calendar' : showSettings} localSkin={localSkin} onLocalSkinChange={setLocalSkin} settings={state.settings} notes={state.notes} appState={state} isElectron={isElectron} onChange={updateSettings} onClose={() => setShowSettings(false)} onCreateNote={createNote} onOpenNote={openNote} onDestroyNote={destroyNote} onApplyRemote={applyRemoteState} syncStatus={syncStatus} onSyncStatusChange={setSyncStatus} syncConflict={syncConflict} onSyncConflictChange={setSyncConflict} />}
        {toast && <div className="toast" role="status"><ListChecks size={16} />{toast}</div>}
      </section>
    </main>
  );
}
