import { Solar } from 'lunar-javascript';
import type { CalendarLayout, RepeatRule, WeekNumberMode } from '../types';

const pad = (value: number) => String(value).padStart(2, '0');
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });

export interface CalendarDayOptions {
  layout?: CalendarLayout;
  maxRows?: number;
  maxColumns?: number;
  elapsedWeeks?: number;
  weekStartsOn?: number;
  today?: string;
  selectedDate?: string;
}

export interface FestivalOptions {
  showLegalHolidays?: boolean;
  showImportantFestivals?: boolean;
}

export function toDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(key: string, amount: number): string {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function startOfMonth(key: string): string {
  const date = fromDateKey(key);
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function addMonths(key: string, amount: number): string {
  const date = fromDateKey(key);
  return toDateKey(new Date(date.getFullYear(), date.getMonth() + amount, 1));
}

export function startOfWeek(key: string, weekStartsOn = 1): string {
  const day = fromDateKey(key).getDay();
  return addDays(key, -((day - weekStartsOn + 7) % 7));
}

export function getCalendarColumns(layout: CalendarLayout = 'full-month', maxColumns = 7): number {
  return layout === 'full-month' ? 7 : Math.min(7, Math.max(1, maxColumns));
}

export function getCalendarDays(month: string, options: CalendarDayOptions = {}): string[] {
  const layout = options.layout ?? 'full-month';
  const maxRows = Math.min(6, Math.max(1, options.maxRows ?? 6));
  const columns = getCalendarColumns(layout, options.maxColumns);
  const weekStartsOn = options.weekStartsOn ?? 1;
  const monthStart = startOfMonth(month);
  let first = startOfWeek(monthStart, weekStartsOn);

  if (layout !== 'full-month') {
    const preferredAnchor = layout === 'floating-week' ? options.selectedDate : options.today;
    const anchor = preferredAnchor && startOfMonth(preferredAnchor) === monthStart ? preferredAnchor : monthStart;
    first = startOfWeek(anchor, weekStartsOn);
    if (layout === 'floating-month') {
      first = addDays(first, -Math.min(5, Math.max(0, options.elapsedWeeks ?? 0)) * 7);
    }
  }

  let rowCount = maxRows;
  if (layout === 'fixed-week' || layout === 'floating-week') {
    rowCount = 1;
  } else if (layout === 'full-month') {
    const daysInMonth = daysBetween(monthStart, startOfMonth(addMonths(monthStart, 1)));
    const weeksNeeded = Math.ceil((daysBetween(first, monthStart) + daysInMonth) / 7);
    rowCount = Math.max(rowCount, weeksNeeded);
  }
  return Array.from({ length: rowCount * columns }, (_, index) => {
    const weekIndex = Math.floor(index / columns);
    const columnIndex = index % columns;
    return addDays(first, weekIndex * 7 + columnIndex);
  });
}

export function daysBetween(from: string, to: string): number {
  const start = fromDateKey(from);
  const end = fromDateKey(to);
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

export function getWeekDays(anchor: string, weekStartsOn = 1): string[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function getWeekNumber(key: string, mode: WeekNumberMode = 'iso'): number {
  const date = fromDateKey(key);
  if (mode === 'jan1') {
    return Math.floor(daysBetween(toDateKey(new Date(date.getFullYear(), 0, 1)), key) / 7) + 1;
  }
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function nextRepeatDate(key: string, repeat: RepeatRule): string {
  const date = fromDateKey(key);
  if (repeat === 'daily') return addDays(key, 1);
  if (repeat === 'weekly') return addDays(key, 7);
  if (repeat === 'monthly' || repeat === 'yearly') {
    const monthOffset = repeat === 'monthly' ? 1 : 12;
    const target = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return toDateKey(target);
  }
  return key;
}

function lunarDayName(day: number): string {
  const names = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (day <= 10) return `初${names[day - 1]}`;
  if (day < 20) return `十${names[day - 11]}`;
  if (day === 20) return '二十';
  if (day < 30) return `廿${names[day - 21]}`;
  return '三十';
}

function lunarFromKey(key: string) {
  const date = fromDateKey(key);
  return Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate()).getLunar();
}

export function lunarDateLabel(key: string): string {
  const parts = lunarFormatter.formatToParts(fromDateKey(key));
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? 1);
  return day === 1 ? month : lunarDayName(day);
}

export function festivalLabel(key: string, options: FestivalOptions = {}): string {
  const showLegalHolidays = options.showLegalHolidays ?? true;
  const showImportantFestivals = options.showImportantFestivals ?? true;
  const date = fromDateKey(key);
  const solar = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const legalSolarFestivals: Record<string, string> = {
    '01-01': '元旦',
    '05-01': '劳动节',
    '10-01': '国庆节',
  };
  const importantSolarFestivals: Record<string, string> = {
    '03-08': '妇女节',
    '06-01': '儿童节',
  };
  if (showLegalHolidays && legalSolarFestivals[solar]) return legalSolarFestivals[solar];
  if (showImportantFestivals && importantSolarFestivals[solar]) return importantSolarFestivals[solar];
  if (showImportantFestivals && date.getMonth() === 10 && date.getDay() === 4 && date.getDate() >= 22 && date.getDate() <= 28) return '感恩节';

  const parts = lunarFormatter.formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (!showLegalHolidays) return '';
  if (month === '正月' && day === 1) return '春节';
  if (month === '五月' && day === 5) return '端午节';
  if (month === '八月' && day === 15) return '中秋节';
  return '';
}

export function solarTermLabel(key: string): string {
  return lunarFromKey(key).getJieQi();
}

export function yiJiLabel(key: string): string {
  const lunar = lunarFromKey(key);
  const yi = lunar.getDayYi().slice(0, 3).join('、');
  const ji = lunar.getDayJi().slice(0, 3).join('、');
  return `宜：${yi}　忌：${ji}`;
}

export function fullDateLabel(key: string): string {
  const date = fromDateKey(key);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
}

export function shortDateLabel(key: string): string {
  const date = fromDateKey(key);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function monthLabel(key: string): string {
  const date = fromDateKey(key);
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

export function taskDateLabel(key: string, today: string): string {
  if (key === today) return '今天';
  if (key === addDays(today, 1)) return '明天';
  if (key === addDays(today, -1)) return '昨天';
  return shortDateLabel(key);
}
