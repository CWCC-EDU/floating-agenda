import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import { addDays, festivalLabel, fromDateKey, fullDateLabel, getWeekNumber, lunarDateLabel, shortDateLabel, solarTermLabel } from '../lib/date';
import { readableTextColor, taskCardColor, taskFontSize } from '../lib/appearance';
import { layoutScheduleEvents } from '../lib/schedule';
import { clockTime, taskTimeLabel } from '../lib/taskTime';
import type { Settings, Task } from '../types';

const WEEKDAY = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
const HOURS = Array.from({ length: 24 }, (_, hour) => clockTime(hour * 60));
type ScheduleMode = 'day' | 'week';
type TaskTime = Pick<Task, 'time' | 'endTime'>;
type Range = { date: string; start: number; end: number };

interface ScheduleViewProps {
  view: ScheduleMode;
  dates: string[];
  today: string;
  selectedDate: string;
  settings: Settings;
  getDayTasks(date: string): Task[];
  getGhostTasks(date: string): Task[];
  renderTask(task: Task, index: number): ReactNode;
  renderGhostTask(task: Task): ReactNode;
  taskColor(task: Task): string;
  onSelectDate(date: string): void;
  onOpenTask(task: Task, displayedDate: string): void;
  onTaskMenu(task: Task, event: MouseEvent<HTMLElement>): void;
  onLeaveTaskCell(cell: HTMLElement): void;
  renderTaskExtras(task: Task): ReactNode;
  onCreate(date: string, time?: TaskTime): void;
}

function minutesNow() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function minuteAt(element: HTMLElement, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return Math.min(1425, Math.max(0, Math.floor((clientY - bounds.top) / bounds.height * 96) * 15));
}

function percentage(minutes: number) {
  return (minutes / 14.4) + '%';
}

interface ScheduleTaskCellProps {
  date: string;
  kind: 'list' | 'all-day';
  preferredFontSize: number;
  minFontSize: number;
  rest?: boolean;
  onCreate(date: string): void;
  onLeave(cell: HTMLElement): void;
  children: ReactNode;
}

function ScheduleTaskCell({ date, kind, preferredFontSize, minFontSize, rest, onCreate, onLeave, children }: ScheduleTaskCellProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const cell = cellRef.current;
    const content = contentRef.current;
    if (!cell || !content) return;

    const fitTasks = () => {
      if (!cell.clientHeight) return;
      const setFontSize = (size: number) => cell.style.setProperty('--task-font-size', size + 'px');
      const overflows = () => content.scrollHeight > cell.clientHeight;
      setFontSize(preferredFontSize);
      if (!overflows()) {
        cell.classList.remove('is-scrollable');
        return;
      }

      setFontSize(minFontSize);
      const needsScroll = overflows();
      cell.classList.toggle('is-scrollable', needsScroll);
      if (needsScroll) return;

      // Find the largest tenth of a pixel that still fits all of the tasks.
      let low = Math.round(minFontSize * 10);
      let high = Math.round(preferredFontSize * 10) - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        setFontSize(middle / 10);
        if (overflows()) high = middle - 1;
        else low = middle;
      }
      setFontSize(low / 10);
    };

    fitTasks();
    const observer = new ResizeObserver(fitTasks);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [children, minFontSize, preferredFontSize]);

  return (
    <div ref={cellRef} className={'schedule-' + kind + '-cell' + (rest ? ' is-rest-day' : '')} data-date={date} onPointerLeave={event => onLeave(event.currentTarget)} onDoubleClick={event => {
      if (!(event.target as HTMLElement).closest('button,input')) onCreate(date);
    }}>
      <div ref={contentRef} className="schedule-task-content">{children}</div>
    </div>
  );
}

export function ScheduleView({
  view, dates, today, selectedDate, settings,
  getDayTasks, getGhostTasks, renderTask, renderGhostTask, taskColor, onSelectDate, onOpenTask, onTaskMenu, onLeaveTaskCell, renderTaskExtras, onCreate,
}: ScheduleViewProps) {
  const timeline = view === 'day' ? settings.showDayTimeAxis : settings.showWeekTimeAxis;
  const baseFontSize = view === 'day' ? settings.dayTaskBaseFontSize : settings.weekTaskBaseFontSize;
  const minFontSize = view === 'day' ? settings.dayTaskMinFontSize : settings.weekTaskMinFontSize;
  const preferredSize = (count: number) => taskFontSize(count, baseFontSize, minFontSize, settings.taskScrollThreshold);
  const drag = useRef<{ pointer: number; initialY: number; start: number; moved: boolean } | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [now, setNow] = useState(minutesNow);

  useEffect(() => {
    if (!timeline) return;
    setNow(minutesNow());
    const timer = window.setInterval(() => setNow(minutesNow()), 30_000);
    return () => window.clearInterval(timer);
  }, [timeline]);

  const selecting = selection !== null;
  useEffect(() => {
    if (!selecting) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        drag.current = null;
        setSelection(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [selecting]);

  function beginRange(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    drag.current = { pointer: event.pointerId, initialY: event.clientY, start: minuteAt(event.currentTarget, event.clientY), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateRange(event: PointerEvent<HTMLDivElement>, date: string) {
    const active = drag.current;
    if (active?.pointer !== event.pointerId || (!active.moved && Math.abs(event.clientY - active.initialY) < 5)) return;
    active.moved = true;
    const end = minuteAt(event.currentTarget, event.clientY);
    setSelection({ date, start: Math.min(active.start, end), end: Math.max(active.start, end) + 15 });
  }

  function finishRange(event: PointerEvent<HTMLDivElement>, date: string) {
    const active = drag.current;
    if (active?.pointer !== event.pointerId) return;
    drag.current = null;
    setSelection(null);
    if (!active.moved || event.type !== 'pointerup') return;
    const end = minuteAt(event.currentTarget, event.clientY);
    const start = Math.min(active.start, end);
    const finish = Math.min(start + 1439, Math.max(active.start, end) + 15);
    onCreate(date, { time: clockTime(start), endTime: clockTime(finish) });
  }

  function createAt(event: MouseEvent<HTMLDivElement>, date: string) {
    if ((event.target as HTMLElement).closest('button')) return;
    const start = minuteAt(event.currentTarget, event.clientY);
    onCreate(date, { time: clockTime(start), endTime: clockTime(start + 60) });
  }

  const days = dates.map(date => {
    const tasks = getDayTasks(date);
    const festival = festivalLabel(date, settings);
    const solarTerm = settings.showSolarTerms ? solarTermLabel(date) : '';
    return {
      date, tasks, ghosts: getGhostTasks(date), allDay: timeline ? tasks.filter(task => !task.time) : [],
      label: festival || solarTerm || (settings.showLunar ? lunarDateLabel(date) : ''),
      labelClass: festival ? 'is-festival' : solarTerm ? 'is-solar-term' : '',
      rest: settings.showRestDays && settings.restDays.includes(fromDateKey(date).getDay()),
    };
  });
  const style = {
    '--schedule-columns': dates.length,
    '--task-base-font-size': baseFontSize + 'px',
    '--task-min-font-size': minFontSize + 'px',
    '--now-color': settings.currentTimeLineColor,
  } as CSSProperties;

  return (
    <section className={'schedule-view is-' + view + (timeline ? ' has-hours' : '')} style={style} aria-label={view === 'week' ? '周视图日程' : '日视图日程'}>
      <div className="schedule-grid schedule-head">
        {timeline && <span className="schedule-gutter">{view === 'week' && settings.showWeekNumbers ? '第' + getWeekNumber(dates[0], settings.weekNumberMode) + '周' : ''}</span>}
        {days.map(({ date, label, labelClass, rest }) => (
          <div key={date} className={'schedule-heading' + (date === today ? ' is-today' : '') + (date === selectedDate ? ' is-selected' : '') + (rest ? ' is-rest-day' : '')}>
            <button className="schedule-date" type="button" aria-label={fullDateLabel(date)} aria-current={date === today ? 'date' : undefined} aria-pressed={date === selectedDate} onClick={() => onSelectDate(date)}>
              <strong>{view === 'week' ? fromDateKey(date).getDate() : shortDateLabel(date)}</strong>
              <span>{WEEKDAY.format(fromDateKey(date))}</span>
              {label && <small className={labelClass} title={label}>{label}</small>}
            </button>
            <button className="schedule-add" type="button" title="添加日程" aria-label={'在 ' + shortDateLabel(date) + ' 添加日程'} onClick={() => onCreate(date)}><Plus size={13} /></button>
          </div>
        ))}
      </div>
      {timeline && <div className="schedule-grid schedule-all-day" role="group" aria-label="全天">
        <span className="schedule-gutter">全天</span>
        {days.map(({ date, allDay, ghosts }) => (
          <ScheduleTaskCell key={date} kind="all-day" date={date} preferredFontSize={preferredSize(allDay.length + ghosts.length)} minFontSize={minFontSize} onLeave={onLeaveTaskCell} onCreate={onCreate}>
            {allDay.map(renderTask)}{ghosts.map(renderGhostTask)}
          </ScheduleTaskCell>
        ))}
      </div>}
      {timeline ? <div className="schedule-grid schedule-clock">
        <div className="schedule-hour-labels" aria-hidden="true">
          {HOURS.map(hour => <span key={hour}>{hour}</span>)}
        </div>
        {days.map(({ date, tasks, rest }) => (
          <div key={date} className={'schedule-hour-column' + (rest ? ' is-rest-day' : '')} data-date={date} onPointerLeave={event => onLeaveTaskCell(event.currentTarget)}
            onDoubleClick={event => createAt(event, date)} onPointerDown={beginRange}
            onPointerMove={event => updateRange(event, date)} onPointerUp={event => finishRange(event, date)}
            onPointerCancel={event => finishRange(event, date)} onLostPointerCapture={event => finishRange(event, date)}>
            {layoutScheduleEvents(tasks, getDayTasks(addDays(date, -1))).map(event => {
              const background = taskCardColor(event.task);
              return (
                <button key={event.task.id} type="button"
                  className={'schedule-event' + (event.task.completed ? ' is-completed' : '') + (event.from === event.to ? ' is-point' : '')}
                  data-task-id={event.task.id} data-late={event.start >= 1160 || undefined} data-continuing={event.continuing || undefined} data-card-color={background ? 'true' : undefined}
                  style={{
                    '--event-top': percentage(event.start), '--event-height': percentage(event.end - event.start),
                    '--event-lane': event.lane, '--event-lanes': event.lanes, '--event-color': taskColor(event.task),
                    '--task-card-background': background,
                    '--task-card-foreground': background ? readableTextColor(background, '', true) : undefined,
                  } as CSSProperties}
                  title={taskTimeLabel(event.task.time, event.task.endTime) + ' ' + event.task.title}
                  onContextMenu={mouseEvent => onTaskMenu(event.task, mouseEvent)}
                  onClick={() => onOpenTask(event.task, date)}>
                  <span className="schedule-event-title">{event.task.completed && settings.showCompletedIcon && <Check size={11} />}<span className="task-title-text">{event.task.title}</span></span>
                  {renderTaskExtras(event.task)}
                  {event.end - event.start >= 40 && <small>{event.continuing ? '00:00–' + clockTime(event.to) : taskTimeLabel(event.task.time, event.task.endTime)}</small>}
                </button>
              );
            })}
            {date === today && <div className="schedule-now" style={{ top: percentage(now) }} title={'现在 ' + clockTime(now)} />}
            {selection?.date === date && <div className="schedule-selection" aria-hidden="true" style={{
              top: percentage(selection.start), height: percentage(selection.end - selection.start),
            }}>{clockTime(selection.start)}–{clockTime(selection.end)}</div>}
          </div>
        ))}
      </div> : <div className="schedule-grid schedule-list">
        {days.map(({ date, tasks, ghosts, rest }) => (
          <ScheduleTaskCell key={date} kind="list" date={date} preferredFontSize={preferredSize(tasks.length + ghosts.length)} minFontSize={minFontSize} rest={rest} onLeave={onLeaveTaskCell} onCreate={onCreate}>
            {tasks.map(renderTask)}
            {ghosts.map(renderGhostTask)}
            {tasks.length === 0 && ghosts.length === 0 && <span className="schedule-empty">无日程</span>}
          </ScheduleTaskCell>
        ))}
      </div>}
    </section>
  );
}
