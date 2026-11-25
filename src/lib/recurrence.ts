import { addDays, daysBetween, fromDateKey, startOfWeek, toDateKey } from './date';
import type { RecurrencePattern, RepeatEnd, RepeatFrequency, RepeatRule } from '../types';

export const REPEAT_OPTIONS: { value: RepeatRule; label: string }[] = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
  { value: 'custom', label: '自定义重复' },
];

export const MAX_REPEAT_COUNT = 999;
export const MAX_REPEAT_INTERVAL = 365;
export const DEFAULT_RECURRENCE: RecurrencePattern = { frequency: 'week', interval: 1, end: { type: 'never' } };
const FREQUENCIES: RepeatFrequency[] = ['day', 'week', 'month', 'year'];

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toDateKey(fromDateKey(value)) === value;
}

export function normalizeRecurrence(value: unknown): RecurrencePattern | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<RecurrencePattern>;
  if (!raw.frequency || !FREQUENCIES.includes(raw.frequency)
    || !Number.isInteger(raw.interval) || raw.interval! < 1 || raw.interval! > MAX_REPEAT_INTERVAL) return undefined;
  let end: RepeatEnd = { type: 'never' };
  if (raw.end?.type === 'count' && Number.isInteger(raw.end.count) && raw.end.count >= 1 && raw.end.count <= MAX_REPEAT_COUNT) {
    end = { type: 'count', count: raw.end.count };
  } else if (raw.end?.type === 'until' && isDateKey(raw.end.date)) {
    end = { type: 'until', date: raw.end.date };
  } else if (raw.end?.type && raw.end.type !== 'never') {
    return undefined;
  }
  const weekdays = raw.frequency === 'week' && Array.isArray(raw.weekdays)
    ? [...new Set(raw.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [];
  return { frequency: raw.frequency, interval: raw.interval!, ...(weekdays.length ? { weekdays } : {}), end };
}

export function nextCustomDate(current: string, anchor: string, pattern: RecurrencePattern): string {
  if (pattern.frequency === 'day') return addDays(current, pattern.interval);
  if (pattern.frequency === 'week') {
    if (!pattern.weekdays?.length) return addDays(current, pattern.interval * 7);
    const week = startOfWeek(current);
    const offsets = pattern.weekdays.map(day => (day + 6) % 7).sort((a, b) => a - b);
    const nextInWeek = offsets.find(offset => offset > daysBetween(week, current));
    return nextInWeek === undefined ? addDays(week, pattern.interval * 7 + offsets[0]) : addDays(week, nextInWeek);
  }
  const date = fromDateKey(current);
  const monthOffset = pattern.interval * (pattern.frequency === 'year' ? 12 : 1);
  const target = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(fromDateKey(anchor).getDate(), lastDay));
  return toDateKey(target);
}
