import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, festivalLabel, getCalendarColumns, getCalendarDays, getWeekDays, getWeekNumber, lunarDateLabel, nextRepeatDate, solarTermLabel, toDateKey, yiJiLabel } from './date';
import { extendRecurringTasks, removeTaskSeries, rolloverTasks, sortTasks } from './tasks';
import type { Task } from '../types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: '整理计划',
    notes: '',
    date: '2026-11-10',
    time: '',
    completed: false,
    createdAt: '2026-11-10T08:00:00.000Z',
    originalDate: '2026-11-10',
    rolloverCount: 0,
    repeat: 'none',
    color: 'default',
    ...overrides,
  };
}

const settings = { rolloverEnabled: true, rolloverWindow: 7 };

describe('rolloverTasks', () => {
  it('moves an unfinished overdue task to today', () => {
    const result = rolloverTasks([task()], '2026-11-11', settings);
    expect(result.moved).toBe(1);
    expect(result.tasks[0]).toMatchObject({
      date: '2026-11-11',
      originalDate: '2026-11-10',
      rolloverCount: 1,
      lastRolledFrom: '2026-11-10',
    });
  });

  it('keeps the first planned date across repeated rollovers', () => {
    const existing = task({
      date: '2026-11-10',
      originalDate: '2026-11-08',
      rolloverCount: 2,
    });
    const result = rolloverTasks([existing], '2026-11-11', settings);
    expect(result.tasks[0].originalDate).toBe('2026-11-08');
    expect(result.tasks[0].rolloverCount).toBe(3);
  });

  it('only moves tasks inside the custom window', () => {
    const tasks = [
      task({ id: 'inside', date: '2026-11-04' }),
      task({ id: 'outside', date: '2026-11-03' }),
    ];
    const result = rolloverTasks(tasks, '2026-11-11', settings);
    expect(result.tasks.find((item) => item.id === 'inside')?.date).toBe('2026-11-11');
    expect(result.tasks.find((item) => item.id === 'outside')?.date).toBe('2026-11-03');
    expect(result.moved).toBe(1);
  });

  it('does not move completed, current, or future tasks', () => {
    const tasks = [
      task({ id: 'done', completed: true }),
      task({ id: 'today', date: '2026-11-11' }),
      task({ id: 'future', date: '2026-11-12' }),
    ];
    const result = rolloverTasks(tasks, '2026-11-11', settings);
    expect(result.moved).toBe(0);
    expect(result.tasks).toEqual(tasks);
  });

  it('does nothing when automatic rollover is disabled', () => {
    const tasks = [task()];
    const result = rolloverTasks(tasks, '2026-11-11', { ...settings, rolloverEnabled: false });
    expect(result.tasks).toBe(tasks);
    expect(result.moved).toBe(0);
  });

  it('leaves recurring tasks on their own dates', () => {
    const tasks = [
      task({ id: 'daily', date: '2026-11-10', repeat: 'daily' }),
      task({ id: 'plain', date: '2026-11-10' }),
    ];
    const result = rolloverTasks(tasks, '2026-11-11', settings);
    expect(result.tasks.find((item) => item.id === 'daily')?.date).toBe('2026-11-10');
    expect(result.tasks.find((item) => item.id === 'plain')?.date).toBe('2026-11-11');
    expect(result.moved).toBe(1);
  });
});

describe('date utilities', () => {
  it('builds a Monday-first week', () => {
    expect(getWeekDays('2026-11-11')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
      '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
  });

  it('builds a stable 42-cell month calendar', () => {
    const days = getCalendarDays('2026-11-01');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-10-26');
    expect(days[41]).toBe('2026-12-06');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
  });

  it('applies floating rows, elapsed weeks, and column limits', () => {
    const days = getCalendarDays('2026-11-01', {
      layout: 'floating-month',
      today: '2026-11-11',
      maxRows: 4,
      maxColumns: 5,
      elapsedWeeks: 1,
      weekStartsOn: 1,
    });
    expect(days).toHaveLength(20);
    expect(days[0]).toBe('2026-11-02');
    expect(days[4]).toBe('2026-11-06');
    expect(days[5]).toBe('2026-11-09');
  });

  it('keeps the whole month visible in full-month layout', () => {
    expect(getCalendarColumns('full-month', 3)).toBe(7);
    expect(getCalendarColumns('floating-month', 5)).toBe(5);
    const days = getCalendarDays('2026-11-01', { layout: 'full-month', maxRows: 3, maxColumns: 5 });
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-10-26');
    expect(days.filter((day) => day.startsWith('2026-11'))).toHaveLength(30);
  });

  it('uses the minimum week count for months that fit fewer rows', () => {
    const days = getCalendarDays('2027-02-01', { layout: 'full-month', maxRows: 1, maxColumns: 2 });
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2027-02-01');
    expect(days[27]).toBe('2027-02-28');
  });

  it('builds a floating single week and a custom week start', () => {
    const days = getCalendarDays('2026-11-01', {
      layout: 'floating-week',
      selectedDate: '2026-11-15',
      today: '2026-11-11',
    });
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-11-09');
    expect(getCalendarDays('2026-11-01', { weekStartsOn: 0 })[0]).toBe('2026-11-01');
  });

  it('handles month boundaries and calendar-day differences', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(toDateKey(new Date(2026, 10, 11))).toBe('2026-11-11');
  });
});

describe('calendar labels and recurrence dates', () => {
  it('calculates ISO week numbers across year boundaries', () => {
    expect(getWeekNumber('2024-01-01')).toBe(1);
    expect(getWeekNumber('2021-01-01')).toBe(53);
    expect(getWeekNumber('2026-11-11')).toBe(46);
  });

  it('clamps monthly and yearly recurrences to valid dates', () => {
    expect(nextRepeatDate('2026-11-11', 'daily')).toBe('2026-11-12');
    expect(nextRepeatDate('2026-11-11', 'weekly')).toBe('2026-11-18');
    expect(nextRepeatDate('2024-01-31', 'monthly')).toBe('2024-02-29');
    expect(nextRepeatDate('2024-02-29', 'yearly')).toBe('2025-02-28');
  });

  it('formats lunar dates and common festivals', () => {
    expect(lunarDateLabel('2024-02-10')).toBe('正月');
    expect(festivalLabel('2024-02-10')).toBe('春节');
    expect(festivalLabel('2024-06-10')).toBe('端午节');
    expect(festivalLabel('2024-09-17')).toBe('中秋节');
    expect(festivalLabel('2026-11-26')).toBe('感恩节');
  });

  it('provides solar terms and lunar almanac hints', () => {
    expect(solarTermLabel('2026-02-04')).toBe('立春');
    expect(yiJiLabel('2026-11-11')).toMatch(/^宜：.+　忌：/);
  });
});

describe('extendRecurringTasks', () => {
  it('pre-creates a daily series through the horizon', () => {
    const seed = task({ date: '2026-11-11', repeat: 'daily' });
    const result = extendRecurringTasks([seed], '2026-11-11');
    expect(result.added).toBe(120);
    expect(result.tasks).toHaveLength(121);
    expect(result.tasks.find((item) => item.id === 'task-1')?.seriesId).toBe('task-1');
    expect(result.tasks.find((item) => item.date === '2026-11-12')).toMatchObject({
      completed: false,
      seriesId: 'task-1',
      originalDate: '2026-11-12',
    });
    expect(result.tasks.some((item) => item.date === '2027-03-11')).toBe(true);
    expect(result.tasks.some((item) => item.date === '2027-03-12')).toBe(false);
  });

  it('copies the latest occurrence and keeps the series idempotent', () => {
    const seed = task({ date: '2026-11-11', repeat: 'weekly', title: '周报', time: '09:00', color: 'mint' });
    const once = extendRecurringTasks([seed], '2026-11-11');
    const next = once.tasks.find((item) => item.date === '2026-11-18');
    expect(next).toMatchObject({ title: '周报', time: '09:00', color: 'mint', repeat: 'weekly', seriesId: 'task-1' });

    const twice = extendRecurringTasks(once.tasks, '2026-11-11');
    expect(twice.added).toBe(0);
    expect(twice.tasks).toBe(once.tasks);
    expect(twice.tasks.filter((item) => item.date === '2026-11-18')).toHaveLength(1);
  });

  it('creates the next yearly occurrence and leaves plain tasks alone', () => {
    const yearly = extendRecurringTasks([task({ repeat: 'yearly' })], '2026-11-11');
    expect(yearly.tasks.some((item) => item.date === '2027-11-10')).toBe(true);

    const plainTasks = [task()];
    const plain = extendRecurringTasks(plainTasks, '2026-11-11');
    expect(plain.added).toBe(0);
    expect(plain.tasks).toBe(plainTasks);
  });
});

describe('removeTaskSeries', () => {
  it('removes every occurrence in the series and keeps unrelated tasks', () => {
    const tasks = [
      task({ id: 'seed', date: '2026-11-10', repeat: 'daily', seriesId: 'seed' }),
      task({ id: 'future', date: '2026-11-11', repeat: 'daily', seriesId: 'seed' }),
      task({ id: 'done', date: '2026-11-09', repeat: 'daily', seriesId: 'seed', completed: true }),
      task({ id: 'plain', date: '2026-11-11' }),
    ];
    expect(removeTaskSeries(tasks, 'seed').map((item) => item.id)).toEqual(['plain']);
  });
});

describe('sortTasks', () => {
  it('sorts by completion, time, then creation order', () => {
    const tasks = [
      task({ id: 'done', completed: true, time: '08:00' }),
      task({ id: 'later', time: '10:00' }),
      task({ id: 'all-day', time: '' }),
    ];
    expect(sortTasks(tasks).map((item) => item.id)).toEqual(['all-day', 'later', 'done']);
    expect(sortTasks(tasks, false).map((item) => item.id)).toEqual(['all-day', 'done', 'later']);
  });
});
