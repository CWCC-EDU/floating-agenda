import { describe, expect, it } from 'vitest';
import { readableTextColor, taskFontSize } from './appearance';

describe('calendar task appearance', () => {
  it('chooses contrasting text for dark and light backgrounds', () => {
    expect(readableTextColor('#0f2634', '#abcdef', true)).toBe('#f4f7f5');
    expect(readableTextColor('#f2f2f2', '#abcdef', true)).toBe('#17252c');
    expect(readableTextColor('#f2f2f2', '#abcdef', false)).toBe('#abcdef');
  });

  it('shrinks fonts gradually and stops at the scroll threshold', () => {
    expect(taskFontSize(1, 12, 7, 4)).toBe(12);
    expect(taskFontSize(3, 12, 7, 4)).toBe(10.7);
    expect(taskFontSize(4, 12, 7, 4)).toBe(10.1);
    expect(taskFontSize(12, 12, 7, 4)).toBe(10.1);
    expect(taskFontSize(30, 10, 7, 30)).toBe(7);
  });
});
