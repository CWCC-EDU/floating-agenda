import type { Settings, Task } from '../types';
import { daysBetween, nextRepeatDate } from './date';

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
    if (task.completed) return task;

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

export function appendNextRecurringTask(tasks: Task[], completedTask: Task, nextId = crypto.randomUUID()): Task[] {
  if (completedTask.repeat === 'none') return tasks;

  const seriesId = completedTask.seriesId ?? completedTask.id;
  const nextDate = nextRepeatDate(completedTask.date, completedTask.repeat);
  const linkedTasks = tasks.map((task) => task.id === completedTask.id ? { ...task, seriesId } : task);
  const alreadyCreated = linkedTasks.some((task) => task.seriesId === seriesId && task.date === nextDate && !task.completed);
  if (alreadyCreated) return linkedTasks;

  return [...linkedTasks, {
    ...completedTask,
    id: nextId,
    date: nextDate,
    completed: false,
    completedAt: undefined,
    createdAt: new Date().toISOString(),
    originalDate: nextDate,
    rolloverCount: 0,
    lastRolledFrom: undefined,
    seriesId,
  }];
}

export function sortTasks(tasks: Task[], completedToBottom = true): Task[] {
  return [...tasks].sort((a, b) => {
    if (completedToBottom && a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
    const timeCompare = (a.time || '00:00').localeCompare(b.time || '00:00');
    return timeCompare || a.createdAt.localeCompare(b.createdAt);
  });
}
