import type { Settings, Task } from '../types';
import { addDays, daysBetween, nextRepeatDate } from './date';

export interface RolloverResult {
  tasks: Task[];
  moved: number;
}

export function rolloverTasks(
  tasks: Task[],
  today: string,
  settings: Pick<Settings, 'rolloverEnabled' | 'rolloverWindow'>,
): RolloverResult {
  if (!settings.rolloverEnabled) return { tasks, moved: 0 };

  let moved = 0;
  const nextTasks = tasks.map((task) => {
    if (task.completed || task.repeat !== 'none') return task;

    const overdueDays = daysBetween(task.date, today);
    if (overdueDays <= 0 || overdueDays > settings.rolloverWindow) return task;

    moved += 1;
    return {
      ...task,
      date: today,
      originalDate: task.originalDate || task.date,
      rolloverCount: task.rolloverCount + 1,
      lastRolledFrom: task.date,
    };
  });

  return { tasks: nextTasks, moved };
}

const RECURRENCE_HORIZON_DAYS = 120;
const YEARLY_HORIZON_DAYS = 400;
const MAX_RECURRENCE_STEPS = 800;

export interface RecurrenceExtension {
  tasks: Task[];
  added: number;
}

export function extendRecurringTasks(tasks: Task[], today: string): RecurrenceExtension {
  const linked = tasks.map((task) => (
    task.repeat !== 'none' && !task.seriesId ? { ...task, seriesId: task.id } : task
  ));
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
    const latest = list.reduce((newest, task) => (task.date > newest.date ? task : newest));
    if (latest.repeat === 'none') return;

    const horizon = addDays(today, latest.repeat === 'yearly' ? YEARLY_HORIZON_DAYS : RECURRENCE_HORIZON_DAYS);
    const dates = new Set(list.map((task) => task.date));
    let cursor = latest.date;
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
          id: crypto.randomUUID(),
          date: cursor,
          completed: false,
          completedAt: undefined,
          createdAt: now,
          originalDate: cursor,
          rolloverCount: 0,
          lastRolledFrom: undefined,
          seriesId,
        });
      }
      cursor = nextRepeatDate(cursor, latest.repeat);
      steps += 1;
    }
  });

  if (additions.length === 0) return { tasks, added: 0 };
  return { tasks: [...linked, ...additions], added: additions.length };
}

export function removeTaskSeries(tasks: Task[], seriesId: string): Task[] {
  return tasks.filter((task) => task.seriesId !== seriesId);
}

export function sortTasks(tasks: Task[], completedToBottom = true): Task[] {
  return [...tasks].sort((a, b) => {
    if (completedToBottom && a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
    const timeCompare = (a.time || '00:00').localeCompare(b.time || '00:00');
    return timeCompare || a.createdAt.localeCompare(b.createdAt);
  });
}
