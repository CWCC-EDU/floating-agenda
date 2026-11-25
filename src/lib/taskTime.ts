const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_TIME.test(value);
}

export function clockTime(minutes: number): string {
  const withinDay = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(withinDay / 60)).padStart(2, '0')}:${String(withinDay % 60).padStart(2, '0')}`;
}

export function timeInMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function isTaskTimeRange(start: string, end?: string): boolean {
  if (!start) return !end;
  return isClockTime(start) && (!end || (isClockTime(end) && end !== start));
}

export function taskTimeLabel(start: string, end?: string): string {
  if (!start || !end) return start;
  return `${start}–${end < start ? '次日 ' : ''}${end}`;
}

export function timeAxisSegment(start: string, end: string | undefined, continuing = false) {
  if (!start || !isTaskTimeRange(start, end)) return null;
  const overnight = Boolean(end && end < start);
  if (continuing && !overnight) return null;
  const from = continuing ? 0 : timeInMinutes(start);
  const to = !end ? from : overnight && !continuing ? 1440 : timeInMinutes(end);
  if (continuing && to === 0) return null;
  return { from, to };
}
