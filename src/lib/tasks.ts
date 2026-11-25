import type { QuickTaskDraft, Settings, Task } from '../types';
import { addDays, daysBetween, nextRepeatDate } from './date';
import { DEFAULT_RECURRENCE, isDateKey, nextCustomDate } from './recurrence';

export function createTask(date: string, draft?: QuickTaskDraft, id: string = crypto.randomUUID()): Task {
  return {
    id,
    title: draft?.title ?? '',
    notes: '',
    date,
    time: draft?.time ?? '',
    ...(draft?.endTime ? { endTime: draft.endTime } : {}),
    completed: false,
    createdAt: new Date().toISOString(),
    originalDate: date,
    rolloverCount: 0,
    repeat: draft?.repeat ?? 'none',
    color: 'default',
    ...(draft?.recurrence ? { recurrence: draft.recurrence, recurrenceStart: date } : {}),
  };
}

export interface RolloverResult {
  tasks: Task[];
  moved: number;
}

export function rolloverTasks(
  tasks: Task[],
  today: string,
  settings: Pick<Settings, 'rolloverEnabled' | 'rolloverWindow'>,
  selectedIds?: ReadonlySet<string>,
): RolloverResult {
  if (!settings.rolloverEnabled && !tasks.some(task => task.rolloverMode === 'on')) return { tasks, moved: 0 };

  let moved = 0;
  const nextTasks = tasks.map((task) => {
    if (task.completed || task.rolloverMode === 'off' || (selectedIds && !selectedIds.has(task.id))) return task;
    // Recurring occurrences keep their scheduled date unless explicitly enabled.
    if (task.rolloverMode !== 'on' && (!settings.rolloverEnabled || task.repeat !== 'none')) return task;

    const overdueDays = daysBetween(task.date, today);
    if (overdueDays <= 0 || overdueDays > settings.rolloverWindow) return task;

    moved += 1;
    return {
      ...task,
      date: today,
      originalDate: task.originalDate || task.date,
      rolloverCount: task.rolloverCount + 1,
      lastRolledFrom: task.date,
      ...(task.repeat === 'none' ? {} : { scheduledRepeatDate: task.scheduledRepeatDate ?? task.date }),
    };
  });

  return { tasks: nextTasks, moved };
}

const RECURRENCE_HORIZON_DAYS = 120;
const YEARLY_HORIZON_DAYS = 400;
const MAX_RECURRENCE_STEPS = 800;
const MAX_CUSTOM_SCHEDULE_STEPS = 40_000;

const scheduledDate = (task: Task) => task.repeat === 'none' ? task.date : task.scheduledRepeatDate ?? task.date;

export interface RecurrenceExtension {
  tasks: Task[];
  added: number;
}

export function extendRecurringTasks(tasks: Task[], today: string): RecurrenceExtension {
  let changed = false;
  const linked = tasks.map(task => {
    if (task.repeat === 'none' || task.seriesId) return task;
    changed = true;
    return { ...task, seriesId: task.id };
  });
  const series = new Map<string, Task[]>();
  linked.forEach((task) => {
    if (!task.seriesId) return;
    const list = series.get(task.seriesId) ?? [];
    list.push(task);
    series.set(task.seriesId, list);
  });

  const additions: Task[] = [];
  const now = new Date().toISOString();
  series.forEach((list, seriesId) => {
    const latest = list.reduce((newest, task) => scheduledDate(task) > scheduledDate(newest) ? task : newest);
    if (latest.repeat === 'none') return;

    if (latest.repeat === 'custom') {
      const pattern = latest.recurrence ?? DEFAULT_RECURRENCE;
      const anchor = latest.recurrenceStart ?? list.reduce((first, task) => {
        const date = scheduledDate(task);
        return date < first ? date : first;
      }, scheduledDate(latest));
      const dates = new Set(list.flatMap(task => [scheduledDate(task), ...(task.recurrenceExcludedDates ?? [])]));
      const horizon = addDays(today, pattern.frequency === 'year' ? YEARLY_HORIZON_DAYS : RECURRENCE_HORIZON_DAYS);
      const count = pattern.end.type === 'count' ? pattern.end.count : Infinity;
      const until = pattern.end.type === 'until' && pattern.end.date < horizon ? pattern.end.date : horizon;
      let cursor = anchor;
      for (let index = 1; index < MAX_CUSTOM_SCHEDULE_STEPS && index < count; index++) {
        cursor = nextCustomDate(cursor, anchor, pattern);
        if (!isDateKey(cursor) || (count === Infinity && cursor > until)) break;
        if (dates.has(cursor) || (count === Infinity && cursor < today)) continue;
        additions.push({
          ...latest,
          subtasks: latest.subtasks?.map(item => ({ ...item, completed: false })),
          id: `${seriesId}:${cursor}`,
          date: cursor,
          completed: false,
          completedAt: undefined,
          originalDate: cursor,
          rolloverCount: 0,
          rolloverMode: undefined,
          scheduledRepeatDate: undefined,
          lastRolledFrom: undefined,
          recurrenceStart: anchor,
        });
      }
      return;
    }

    const horizon = addDays(today, latest.repeat === 'yearly' ? YEARLY_HORIZON_DAYS : RECURRENCE_HORIZON_DAYS);
    const dates = new Set(list.map(scheduledDate));
    let cursor = scheduledDate(latest);
    let steps = 0;
    while (cursor < today && steps < MAX_RECURRENCE_STEPS) {
      cursor = nextRepeatDate(cursor, latest.repeat);
      steps += 1;
    }
    if (cursor < today) return;
    while (cursor <= horizon && steps < MAX_RECURRENCE_STEPS) {
      if (!dates.has(cursor)) {
        dates.add(cursor);
        additions.push({
          ...latest,
          subtasks: latest.subtasks?.map(item => ({ ...item, completed: false })),
          id: crypto.randomUUID(),
          date: cursor,
          completed: false,
          completedAt: undefined,
          createdAt: now,
          originalDate: cursor,
          rolloverCount: 0,
          rolloverMode: undefined,
          scheduledRepeatDate: undefined,
          lastRolledFrom: undefined,
          seriesId,
        });
      }
      cursor = nextRepeatDate(cursor, latest.repeat);
      steps += 1;
    }
  });

  if (additions.length === 0) return { tasks: changed ? linked : tasks, added: 0 };
  return { tasks: [...linked, ...additions], added: additions.length };
}

export function updateDayTasks(tasks: Task[], date: string, edited: Task[], managed: ReadonlySet<string>, today: string): Task[] {
  let remaining = tasks.filter(task => !managed.has(task.id));
  const previous = new Map(tasks.filter(task => managed.has(task.id)).map(task => [task.id, task]));
  const links = new Map<string, string[]>();
  const updated = edited.map(editedTask => {
    const old = previous.get(editedTask.id);
    // A task can roll forward while its original day is still being edited.
    const task = old && old.date !== date ? { ...editedTask, date: old.date, originalDate: old.originalDate,
      rolloverCount: old.rolloverCount, lastRolledFrom: old.lastRolledFrom, scheduledRepeatDate: old.scheduledRepeatDate } : editedTask;
    const customChanged = old && (old.repeat === 'custom' || task.repeat === 'custom')
      && (old.repeat !== task.repeat || JSON.stringify(old.recurrence) !== JSON.stringify(task.recurrence));
    if (customChanged && old.seriesId) {
      const oldSeries = old.seriesId;
      const completedDates = remaining.filter(item => item.seriesId === oldSeries && item.completed && item.date > date).map(item => item.date);
      remaining = remaining.flatMap(item => {
        if (item.seriesId !== oldSeries) return [item];
        if (item.date > date && !item.completed) return [];
        return [{ ...item, repeat: 'none', seriesId: undefined, recurrence: undefined,
          recurrenceStart: undefined, scheduledRepeatDate: undefined, recurrenceExcludedDates: undefined }];
      });
      return { ...task, seriesId: task.id, recurrenceStart: task.date, scheduledRepeatDate: undefined, recurrenceExcludedDates: completedDates };
    }
    if (old?.repeat === 'custom' && task.repeat === 'custom') {
      return { ...task, recurrenceStart: task.recurrenceStart ?? old.recurrenceStart ?? date,
        recurrenceExcludedDates: [...new Set([...(task.recurrenceExcludedDates ?? []), ...(old.recurrenceExcludedDates ?? [])])] };
    }
    return task.repeat === 'custom' ? { ...task, recurrenceStart: task.recurrenceStart ?? date } : task;
  });
  const kept = new Set(updated.map(task => task.id));
  previous.forEach(task => {
    if (managed.has(task.id) && !kept.has(task.id) && task.repeat === 'custom' && task.seriesId) {
      links.set(task.seriesId, [...(links.get(task.seriesId) ?? []), scheduledDate(task)]);
    }
  });
  const merged = [...remaining, ...updated].map(task => {
    const skipped = task.seriesId && links.get(task.seriesId);
    return skipped ? { ...task, recurrenceExcludedDates: [...new Set([...(task.recurrenceExcludedDates ?? []), ...skipped])] } : task;
  });
  return extendRecurringTasks(merged, today).tasks;
}

export function cancelTaskSeriesFrom(tasks: Task[], seriesId: string, cutoff: string): Task[] {
  return tasks.flatMap(task => {
    if ((task.seriesId ?? (task.repeat !== 'none' ? task.id : undefined)) !== seriesId) return [task];
    if (scheduledDate(task) >= cutoff && !task.completed) return [];
    return [{ ...task, repeat: 'none', seriesId: undefined, recurrence: undefined, recurrenceStart: undefined,
      recurrenceExcludedDates: undefined, scheduledRepeatDate: undefined }];
  });
}

export function sortTasks(tasks: Task[], completedToBottom = true): Task[] {
  return [...tasks].sort((a, b) => {
    if (completedToBottom && a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
    const timeCompare = (a.time || '00:00').localeCompare(b.time || '00:00');
    return timeCompare || a.createdAt.localeCompare(b.createdAt);
  });
}
