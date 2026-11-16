import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ListChecks, LogOut, Menu, Move, Palette, Plus, Repeat2, Settings2, StickyNote } from 'lucide-react';
import { DayEditorDialog } from './components/DayEditorDialog';
import { NotesPanel } from './components/NotesPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { addMonths, festivalLabel, fromDateKey, fullDateLabel, getCalendarColumns, getCalendarDays, getWeekNumber, lunarDateLabel, monthLabel, shortDateLabel, solarTermLabel, startOfMonth, toDateKey, yiJiLabel } from './lib/date';
import { appendNextRecurringTask, rolloverTasks, sortTasks } from './lib/tasks';
import { DEFAULT_SETTINGS, loadAppState, saveAppState } from './lib/storage';
import { readableTextColor, taskFontSize } from './lib/appearance';
import { playSound } from './lib/sound';
import type { AppState, Settings, Task, TaskFilter, WindowAdjustmentMode, WindowResizeEdge } from './types';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WINDOW_RESIZE_EDGES: WindowResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const TOP_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const TASK_TEXT_COLORS = { mint: '#9fd7b5', blue: '#91c6e5', amber: '#e2be83', rose: '#dfa19e', violet: '#b9a9dc' } as const;
type ToggleSetting = 'autoNumber' | 'showWeekNumbers' | 'showLunar' | 'rolloverEnabled' | 'autoStartEnabled';

export default function App() {
  const [today, setToday] = useState(toDateKey());
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthCursor, setMonthCursor] = useState(startOfMonth(today));
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [state, setState] = useState<AppState>({ tasks: [], notes: [], settings: DEFAULT_SETTINGS });
  const [isReady, setIsReady] = useState(false);
  const [editor, setEditor] = useState<{ date: string; taskId?: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWindowMenu, setShowWindowMenu] = useState(false);
  const [showContent, setShowContent] = useState(true);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [toast, setToast] = useState('');
  const adjustmentPointer = useRef<number | null>(null);
  const notifiedTasks = useRef(new Set<string>());
  const isElectron = Boolean(window.desktop);

  useEffect(() => {
    if (!isElectron) return;
    void window.desktop?.setInteractionActive(showSettings || Boolean(editor));
  }, [editor, isElectron, showSettings]);

  useEffect(() => {
    if (!isElectron) return;
    const requestFocus = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
      if (editable) {
        editable.focus({ preventScroll: true });
        if (editable.isContentEditable) {
          const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
          if (range && editable.contains(range.startContainer)) {
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        }
      }
      void window.desktop?.focusWindow();
    };
    window.addEventListener('pointerdown', requestFocus, true);
    return () => window.removeEventListener('pointerdown', requestFocus, true);
  }, [isElectron]);

  useEffect(() => {
    let active = true;
    loadAppState().then((saved) => {
      if (!active) return;
      const result = rolloverTasks(saved.tasks, toDateKey(), saved.settings);
      setState({ ...saved, tasks: result.tasks });
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
    saveAppState(state).catch(() => setToast('保存失败，请检查本地存储权限'));
  }, [state, isReady]);

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
      notifiedTasks.current.clear();
      setState((current) => {
        const result = rolloverTasks(current.tasks, nextToday, current.settings);
        if (result.moved > 0) setToast(`新的一天，已顺延 ${result.moved} 项未完成任务`);
        return { ...current, tasks: result.tasks };
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

  const calendarDays = useMemo(() => getCalendarDays(monthCursor, {
    layout: state.settings.layout,
    maxRows: state.settings.maxRows,
    maxColumns: state.settings.maxColumns,
    elapsedWeeks: state.settings.elapsedWeeks,
    weekStartsOn: state.settings.weekStartsOn,
    today,
    selectedDate,
  }), [monthCursor, selectedDate, state.settings.layout, state.settings.maxRows, state.settings.maxColumns, state.settings.elapsedWeeks, state.settings.weekStartsOn, today]);

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    state.tasks.forEach((task) => {
      const tasks = grouped.get(task.date) ?? [];
      tasks.push(task);
      grouped.set(task.date, tasks);
    });
    return grouped;
  }, [state.tasks]);

  const columnCount = getCalendarColumns(state.settings.layout, state.settings.maxColumns);
  const weekdays = useMemo(() => Array.from({ length: columnCount }, (_, index) => WEEKDAYS[(state.settings.weekStartsOn + index) % 7]), [columnCount, state.settings.weekStartsOn]);
  const rowCount = Math.ceil(calendarDays.length / columnCount);
  const defaultTaskColor = readableTextColor(state.settings.backgroundColor, state.settings.taskTextColor, state.settings.taskAdaptiveColor);

  function matchesFilter(task: Task) {
    if (!state.settings.showCompletedTasks && task.completed) return false;
    if (filter === 'pending') return !task.completed;
    if (filter === 'completed') return task.completed;
    return true;
  }

  function updateSettings(settings: Settings) {
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

  function goToToday() {
    setSelectedDate(today);
    setMonthCursor(startOfMonth(today));
  }

  function saveDayTasks(date: string, editedTasks: Task[]) {
    setState((current) => {
      const previousTasks = current.tasks.filter((task) => task.date === date);
      const previousById = new Map(previousTasks.map((task) => [task.id, task]));
      const sortedTasks = sortTasks(editedTasks, current.settings.completedToBottom);
      let tasks = [...current.tasks.filter((task) => task.date !== date), ...sortedTasks];
      editedTasks.forEach((task) => {
        const previous = previousById.get(task.id);
        if (task.completed && (!previous || !previous.completed)) tasks = appendNextRecurringTask(tasks, task);
      });
      return { ...current, tasks };
    });
    setSelectedDate(date);
    setMonthCursor(startOfMonth(date));
    setEditor(null);
    playSound(state.settings.editSaveSound);
    setToast('当天日程已保存');
  }

  function toggleTaskCompletion(task: Task) {
    setState((current) => {
      const updated = { ...task, completed: !task.completed, completedAt: task.completed ? undefined : new Date().toISOString() };
      let tasks = current.tasks.map((item) => item.id === task.id ? updated : item);
      if (updated.completed) tasks = appendNextRecurringTask(tasks, updated);
      return { ...current, tasks };
    });
    playSound(state.settings.editSaveSound);
  }

  function completeSelectedTask() {
    const task = sortTasks((tasksByDate.get(selectedDate) ?? []).filter((item) => !item.completed), state.settings.completedToBottom)[0];
    if (task) toggleTaskCompletion(task);
    else setToast('选中日期没有待完成任务');
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
    if (adjustmentPointer.current !== event.pointerId) return;
    void window.desktop?.updateWindowAdjustment();
  }

  function stopWindowAdjustment(event: PointerEvent<HTMLElement>) {
    if (adjustmentPointer.current !== event.pointerId) return;
    adjustmentPointer.current = null;
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
        setMonthCursor((current) => addMonths(current, -1));
      } else if (action === 'next-month') {
        setMonthCursor((current) => addMonths(current, 1));
      } else if (action === 'today') {
        goToToday();
      } else if (action === 'toggle-content') {
        setShowContent((current) => !current);
      } else if (action === 'toggle-notes') {
        setState((current) => ({ ...current, settings: { ...current.settings, showNotes: !current.settings.showNotes } }));
      } else if (action === 'complete-selected') {
        completeSelectedTask();
      } else if (action.startsWith('filter:')) {
        setFilter(action.slice(7) as TaskFilter);
      } else if (action.startsWith('toggle:')) {
        toggleSetting(action.slice(7) as ToggleSetting);
      }
    });
  }, [selectedDate, today, state.tasks, state.settings]);

  const backgroundAlpha = Math.round(state.settings.opacity / 100 * 255).toString(16).padStart(2, '0');
  const appStyle = {
    '--calendar-background': `${state.settings.backgroundColor}${backgroundAlpha}`,
    '--cell-gap': `${state.settings.cellGap}px`,
    '--today-color': state.settings.todayColor,
    '--calendar-font-family': state.settings.calendarFontFamily,
    '--calendar-font-size': `${state.settings.calendarFontSize}px`,
    '--calendar-text-color': state.settings.calendarTextColor,
    '--task-color': defaultTaskColor,
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
    <main className={`desktop-canvas ${isElectron ? 'is-electron' : 'is-web'}`}>
      <section className={`calendar-shell ${isAdjusting ? 'is-adjusting' : ''} ${state.settings.blurEnabled ? '' : 'no-blur'} ${state.settings.showShadow ? 'with-shadow' : ''} ${showContent ? '' : 'content-hidden'} ${state.settings.showTitleBar ? '' : 'no-titlebar'}`} style={appStyle} aria-label="浮屿桌面月历">
        {state.settings.showTitleBar && <header className="calendar-topbar" onPointerDown={(event) => startWindowAdjustment(event, 'move')} onPointerMove={updateWindowAdjustment} onPointerUp={stopWindowAdjustment} onPointerCancel={stopWindowAdjustment}>
          <div className="topbar-month-nav">
            <button type="button" className="topbar-arrow" aria-label="上个月" title="上个月" onClick={() => setMonthCursor((current) => addMonths(current, -1))}><ChevronLeft size={13} /></button>
            <div className="topbar-date">{TOP_DATE_FORMATTER.format(fromDateKey(today))}</div>
            <button type="button" className="topbar-arrow" aria-label="下个月" title="下个月" onClick={() => setMonthCursor((current) => addMonths(current, 1))}><ChevronRight size={13} /></button>
          </div>
          <div className="window-controls">
            <button type="button" aria-label="打开功能菜单" title="功能菜单" aria-expanded={showWindowMenu} onClick={() => setShowWindowMenu((current) => !current)}><Menu size={17} /></button>
          </div>
        </header>}

        {showWindowMenu && <>
          <div className="window-menu-backdrop" aria-hidden="true" onPointerDown={() => setShowWindowMenu(false)} />
          <div className="window-function-menu" role="menu" aria-label="日历功能">
            <label className="window-menu-date"><CalendarDays size={15} /><span>选择日期</span><input type="month" aria-label="选择月份" value={monthCursor.slice(0, 7)} onChange={(event) => { if (event.target.value) setMonthCursor(`${event.target.value}-01`); }} /></label>
            <button type="button" role="menuitem" onClick={openSettingsFromMenu}><Palette size={15} /><span>主题皮肤</span></button>
            <button type="button" role="menuitem" onClick={() => { setShowWindowMenu(false); setState((current) => ({ ...current, settings: { ...current.settings, showNotes: !current.settings.showNotes } })); }}><StickyNote size={15} /><span>{state.settings.showNotes ? '隐藏桌面便签' : '显示桌面便签'}</span></button>
            <button type="button" role="menuitem" className={isAdjusting ? 'is-active' : ''} disabled={!isElectron} onClick={toggleAdjustmentMode}><Move size={15} /><span>{isAdjusting ? '完成位置和大小调整' : '调整位置和大小'}</span>{isAdjusting && <Check size={14} />}</button>
            <button type="button" role="menuitem" disabled={!isElectron} onClick={() => { setShowWindowMenu(false); void window.desktop?.minimizeWindow(); }}><ChevronDown size={15} /><span>隐藏日历清单</span></button>
            <div className="window-menu-separator" />
            <button type="button" role="menuitem" onClick={openSettingsFromMenu}><Settings2 size={15} /><span>日历设置</span></button>
            <button type="button" role="menuitem" disabled={!isElectron} onClick={() => void window.desktop?.quitApp()}><LogOut size={15} /><span>退出软件</span></button>
          </div>
        </>}

        {showContent && <>
          <div className={`weekday-grid ${state.settings.showWeekNumbers ? 'has-week-numbers' : ''}`}>
            {state.settings.showWeekNumbers && <span className="week-number-heading">周</span>}
            {weekdays.map((weekday, index) => <span className={state.settings.restDays.includes(fromDateKey(calendarDays[index] ?? today).getDay()) ? 'is-weekend' : ''} key={`${weekday}-${index}`}>{weekday}</span>)}
          </div>

          <div className={`calendar-grid ${state.settings.showWeekNumbers ? 'has-week-numbers' : ''} ${state.settings.showMonthSeparator ? 'has-month-separator' : ''}`} role="grid" aria-label={`${monthLabel(monthCursor)}日程`}>
            {calendarDays.map((date, index) => {
              const day = fromDateKey(date);
              const isCurrentMonth = startOfMonth(date) === monthCursor;
              const dayTasks = sortTasks((tasksByDate.get(date) ?? []).filter(matchesFilter), state.settings.completedToBottom);
              const festival = festivalLabel(date, state.settings);
              const solarTerm = state.settings.showSolarTerms ? solarTermLabel(date) : '';
              const secondaryLabel = festival || solarTerm || (state.settings.showLunar ? lunarDateLabel(date) : '');
              const isRestDay = state.settings.showRestDays && state.settings.restDays.includes(day.getDay());
              const fontSize = taskFontSize(dayTasks.length, state.settings.taskBaseFontSize, state.settings.taskMinFontSize, state.settings.taskScrollThreshold);
              return (
                <Fragment key={date}>
                  {state.settings.showWeekNumbers && index % columnCount === 0 && <div className={`week-number-cell ${index >= calendarDays.length - columnCount ? 'is-last-row' : ''}`}>{getWeekNumber(date, state.settings.weekNumberMode)}</div>}
                  <div
                    className={`day-cell ${isCurrentMonth ? '' : 'is-other-month'} ${date === today ? 'is-today' : ''} ${date === selectedDate ? 'is-selected' : ''} ${isRestDay ? 'is-weekend' : ''} ${index % columnCount === columnCount - 1 ? 'is-last-column' : ''} ${index >= calendarDays.length - columnCount ? 'is-last-row' : ''}`}
                    role="gridcell"
                    aria-selected={date === selectedDate}
                    aria-label={`${fullDateLabel(date)}，${dayTasks.length} 项日程`}
                    onClick={() => setSelectedDate(date)}
                    onDoubleClick={(event) => addFromDoubleClick(event, date)}
                  >
                    <div className="day-cell-header">
                      <span className="day-number">{day.getDate()}</span>
                      {secondaryLabel && <span className={`lunar-label ${festival ? 'is-festival' : ''} ${!festival && solarTerm ? 'is-solar-term' : ''}`} title={state.settings.showYiJi ? yiJiLabel(date) : secondaryLabel}>{secondaryLabel}</span>}
                      <button className="day-add" type="button" aria-label={`在 ${shortDateLabel(date)} 添加日程`} title="添加日程" onClick={(event) => { event.stopPropagation(); setEditor({ date }); }}><Plus size={13} /></button>
                    </div>

                    <div className={`day-tasks ${dayTasks.length > state.settings.taskScrollThreshold ? 'is-scrollable' : ''}`} style={{ '--task-font-size': `${fontSize}px` } as CSSProperties}>
                      {dayTasks.map((task, taskIndex) => (
                        <div className={`calendar-task ${task.completed ? 'is-completed' : ''}`} data-color={task.color} data-background={state.settings.taskTextBackground} style={{ '--task-item-color': task.color === 'default' ? defaultTaskColor : TASK_TEXT_COLORS[task.color] } as CSSProperties} key={task.id}>
                          {state.settings.showCompletedCheckbox && <input className="task-checkbox" type="checkbox" aria-label={`完成 ${task.title}`} checked={task.completed} onClick={(event) => event.stopPropagation()} onChange={() => toggleTaskCompletion(task)} />}
                          <button className="calendar-task-label" type="button" title={`${task.time ? `${task.time} ` : ''}${task.title}`} onClick={(event) => { event.stopPropagation(); setEditor({ date, taskId: task.id }); }}>
                            {state.settings.bulletStyle !== 'none' && <span className="task-number">{state.settings.bulletStyle === 'number' ? `${taskIndex + 1}.` : '•'}</span>}
                            <span className="task-title">{task.title}</span>
                            {state.settings.showReminderTime && task.time && <span className="task-time">{task.time}</span>}
                            {task.completed && state.settings.showCompletedIcon && <Check className="task-complete-icon" size={11} />}
                            {task.repeat !== 'none' && <span className="task-indicators"><Repeat2 className="task-repeat" size={10} /></span>}
                          </button>
                        </div>
                      ))}
                      {dayTasks.length === 0 && <span className="double-click-hint">双击添加</span>}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </>}

        {state.settings.showNotes && <NotesPanel notes={state.notes} settings={state.settings} onChange={(notes) => setState((current) => ({ ...current, notes }))} onClose={() => setState((current) => ({ ...current, settings: { ...current.settings, showNotes: false } }))} />}

        {isAdjusting && <>
          <div className="adjustment-guard" aria-hidden="true" />
          {!state.settings.showTitleBar && <div className="adjustment-move-edge" aria-label="拖动移动日历" onPointerDown={(event) => startWindowAdjustment(event, 'move')} onPointerMove={updateWindowAdjustment} onPointerUp={stopWindowAdjustment} onPointerCancel={stopWindowAdjustment} />}
          {WINDOW_RESIZE_EDGES.map((edge) => <div key={edge} className={`adjustment-border adjustment-border-${edge}`} aria-hidden="true" onPointerDown={(event) => startWindowAdjustment(event, 'resize', edge)} onPointerMove={updateWindowAdjustment} onPointerUp={stopWindowAdjustment} onPointerCancel={stopWindowAdjustment} />)}
          <div className="adjustment-status">{state.settings.showTitleBar ? '拖动标题栏移动' : '拖动顶部移动'} · 拖动最外侧边缘调整大小 · 从右上角菜单退出</div>
        </>}

        {!isReady && <div className="loading-cover"><span /><p>正在整理你的日历…</p></div>}
        {editor && <DayEditorDialog date={editor.date} tasks={tasksByDate.get(editor.date) ?? []} initialTaskId={editor.taskId} settings={state.settings} onSave={(tasks) => saveDayTasks(editor.date, tasks)} onClose={() => setEditor(null)} />}
        {showSettings && <SettingsDialog settings={state.settings} isElectron={isElectron} onChange={updateSettings} onClose={() => setShowSettings(false)} onOpenNotes={() => { setShowSettings(false); setState((current) => ({ ...current, settings: { ...current.settings, showNotes: true } })); }} />}
        {toast && <div className="toast" role="status"><ListChecks size={16} />{toast}</div>}
      </section>
    </main>
  );
}
