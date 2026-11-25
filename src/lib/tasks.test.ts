import { describe, expect, it } from 'vitest';
import { addDays, addMonths, adjacentCalendarPage, daysBetween, festivalLabel, getCalendarColumns, getCalendarDays, getWeekDays, getWeekNumber, lunarDateLabel, nextRepeatDate, solarTermLabel, toDateKey, yiJiLabel } from './date';
import { extendRecurringTasks, cancelTaskSeriesFrom, rolloverTasks, sortTasks, updateDayTasks } from './tasks';
import { layoutScheduleEvents } from './schedule';
import { isTaskTimeRange, timeAxisSegment } from './taskTime';
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

it('projects time ranges onto the date axis without inventing durations or duplicating midnight', () => {
  expect(isTaskTimeRange('09:00', '09:00')).toBe(false);
  expect(timeAxisSegment('09:00', undefined)).toEqual({ from: 540, to: 540 });
  expect(timeAxisSegment('23:30', '01:00')).toEqual({ from: 1410, to: 1440 });
  expect(timeAxisSegment('23:30', '01:00', true)).toEqual({ from: 0, to: 60 });
  expect(timeAxisSegment('23:30', '00:00', true)).toBeNull();
});

describe('custom recurrences and quick capture', () => {
  it('counts the first entry and restores the original day after a short month', () => {
    const original = task({
      date: '2026-01-31', repeat: 'custom',
      recurrence: { frequency: 'month', interval: 1, end: { type: 'count', count: 3 } },
    });
    const extended = extendRecurringTasks([original], original.date);
    expect(extended.tasks.map(item => item.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(extendRecurringTasks(extended.tasks, '2026-12-01').added).toBe(0);
  });

  it('uses selected weekdays on alternating weeks and includes the end date', () => {
    const original = task({
      date: '2026-11-09', repeat: 'custom',
      recurrence: { frequency: 'week', interval: 2, weekdays: [1, 4], end: { type: 'until', date: '2026-11-26' } },
    });
    expect(extendRecurringTasks([original], original.date).tasks.map(item => item.date))
      .toEqual(['2026-11-09', '2026-11-12', '2026-11-23', '2026-11-26']);
  });

  it('keeps an individually deleted occurrence deleted and preserves quick entries added during editing', () => {
    const original = task({
      repeat: 'custom', recurrence: { frequency: 'day', interval: 1, end: { type: 'count', count: 3 } },
    });
    const { tasks } = extendRecurringTasks([original], original.date);
    const last = tasks[2];
    const newTask = task({ id: 'quick', title: '速记', date: last.date });
    const lead = updateDayTasks([...tasks, newTask], last.date, [], new Set([last.id]), original.date);
    expect(lead.some(item => item.id === last.id)).toBe(false);
    expect(lead).toContain(newTask);
    expect(extendRecurringTasks(lead, original.date).added).toBe(0);
  });

  it('rebuilds future entries from an edited rule and preserves the prior occurrence', () => {
    const original = task({
      repeat: 'custom', recurrence: { frequency: 'day', interval: 1, end: { type: 'count', count: 4 } },
    });
    const { tasks } = extendRecurringTasks([original], original.date);
    const chosen = tasks[1];
    const revised = { ...chosen, recurrence: { frequency: 'day', interval: 3, end: { type: 'count', count: 2 } } } as Task;
    const updated = updateDayTasks(tasks, chosen.date, [revised], new Set([chosen.id]), original.date);
    expect(updated.map(item => item.date)).toEqual(['2026-11-10', '2026-11-11', '2026-11-14']);
  });
});

describe('rolloverTasks', () => {
  it('lets a task explicitly opt in or out independently of the global setting', () => {
    const tasks = [task({ id: 'inherited' }), task({ id: 'enabled', rolloverMode: 'on' }), task({ id: 'disabled', rolloverMode: 'off' })];
    expect(rolloverTasks(tasks, '2026-11-11', { ...settings, rolloverEnabled: false }).tasks.map(item => item.date))
      .toEqual(['2026-11-10', '2026-11-11', '2026-11-10']);
    expect(rolloverTasks(tasks, '2026-11-11', settings).tasks.map(item => item.date))
      .toEqual(['2026-11-11', '2026-11-11', '2026-11-10']);
  });

  it('keeps a moved repeating occurrence linked and leaves the next occurrence on the global default', () => {
    const original = task({
      repeat: 'custom', rolloverMode: 'on',
      recurrence: { frequency: 'day', interval: 2, end: { type: 'count', count: 3 } },
    });
    const rolled = rolloverTasks([original], '2026-11-11', settings).tasks;
    const { tasks } = extendRecurringTasks(rolled, '2026-11-11');
    expect(tasks.map(item => item.date)).toEqual(['2026-11-11', '2026-11-12', '2026-11-14']);
    expect(tasks.map(item => item.rolloverMode)).toEqual(['on', undefined, undefined]);
    const updated = updateDayTasks(tasks, original.date, [{ ...original, time: '' }], new Set([original.id]), '2026-11-11');
    expect(updated.filter(item => item.id === original.id).map(item => item.date)).toEqual(['2026-11-11']);
  });

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

  it('advances custom pages by the number of visible whole weeks across years and back', () => {
    const options = { layout: 'floating-month', weekStartsOn: 0, maxRows: 2, maxColumns: 5 } as const;
    const first = '2026-12-20';
    const next = adjacentCalendarPage(first, options.maxRows, 1);
    expect(next).toBe('2027-01-03');
    const before = getCalendarDays('2026-12-01', { ...options, firstWeek: first });
    const after = getCalendarDays('2027-01-01', { ...options, firstWeek: next });
    expect(before).toHaveLength(10);
    expect(after).toHaveLength(10);
    expect(before[5]).toBe('2026-12-27');
    expect(after[0]).toBe('2027-01-03');
    expect(adjacentCalendarPage(next, options.maxRows, -1)).toBe(first);
    expect(adjacentCalendarPage(first, 1, 1)).toBe('2026-12-27');
    expect(adjacentCalendarPage(first, 4, 1)).toBe('2027-01-17');
  });

  it('keeps today in short floating layouts even when more past weeks are configured', () => {
    const today = '2026-11-25';
    expect(getCalendarDays(today, { layout: 'floating-month', today, maxRows: 1, elapsedWeeks: 5 })).toContain(today);
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
    const seed = task({ date: '2026-11-11', repeat: 'weekly', title: '周报', time: '09:00', endTime: '10:00', color: 'mint' });
    const once = extendRecurringTasks([seed], '2026-11-11');
    const next = once.tasks.find((item) => item.date === '2026-11-18');
    expect(next).toMatchObject({ title: '周报', time: '09:00', endTime: '10:00', color: 'mint', repeat: 'weekly', seriesId: 'task-1' });

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

describe('cancelTaskSeriesFrom', () => {
  it('retains older and completed occurrences, removing only pending occurrences on and after the cutoff', () => {
    const tasks = [
      task({ id: 'seed', date: '2026-11-10', repeat: 'daily', seriesId: 'seed' }),
      task({ id: 'future', date: '2026-11-11', repeat: 'daily', seriesId: 'seed' }),
      task({ id: 'done', date: '2026-11-09', repeat: 'daily', seriesId: 'seed', completed: true }),
      task({ id: 'later-done', date: '2026-11-12', repeat: 'daily', seriesId: 'seed', completed: true }),
      task({ id: 'rolled', date: '2026-11-11', scheduledRepeatDate: '2026-11-09', repeat: 'daily', seriesId: 'seed' }),
      task({ id: 'plain', date: '2026-11-11' }),
    ];
    const retained = cancelTaskSeriesFrom(tasks, 'seed', '2026-11-11');
    expect(retained.map(item => item.id)).toEqual(['seed', 'done', 'later-done', 'rolled', 'plain']);
    expect(retained.filter(task => task.completed).map(task => task.id)).toEqual(['done', 'later-done']);
    expect(retained.every(task => task.repeat === 'none' && !task.seriesId)).toBe(true);
    expect(extendRecurringTasks(retained, '2026-11-11')).toEqual({ tasks: retained, added: 0 });
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

describe('day and week time blocks', () => {
  it('places overlaps beside each other and reuses the lane after their cluster ends', () => {
    const events = layoutScheduleEvents([
      task({ id: 'overlap', time: '09:30', endTime: '10:30' }),
      task({ id: 'morning', time: '09:00', endTime: '10:00' }),
      task({ id: 'after', time: '10:30', endTime: '11:00' }),
      task({ id: 'all-day' }),
    ], []);
    expect(events.map(({ task, lane, lanes }) => [task.id, lane, lanes])).toEqual([
      ['morning', 0, 2], ['overlap', 1, 2], ['after', 0, 1],
    ]);
  });

  it('renders a single midnight continuation and a clickable legacy point within the grid', () => {
    const overnight = task({ id: 'night', time: '23:30', endTime: '01:00' });
    const point = task({ id: 'point', time: '23:59' });
    const events = layoutScheduleEvents([point], [overnight, task({ time: '22:00' })]);
    expect(events.map(({ task, from, to, continuing }) => [task.id, from, to, continuing])).toEqual([
      ['night', 0, 60, true], ['point', 1439, 1439, false],
    ]);
    expect(events[1].end).toBe(1440);
    expect(events[1].end).toBeGreaterThan(events[1].start);
  });
});
