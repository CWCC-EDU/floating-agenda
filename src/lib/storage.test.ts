import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeAppState } from './storage';

describe('state normalization', () => {
  it('fills new settings without removing existing tasks', () => {
    const state = normalizeAppState({
      tasks: [{ id: 'one', title: '保留任务', date: '2026-11-11' }],
      settings: { autoNumber: false, opacity: 140, maxRows: 99 },
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].title).toBe('保留任务');
    expect(state.settings.bulletStyle).toBe('none');
    expect(state.settings.opacity).toBe(100);
    expect(state.settings.maxRows).toBe(6);
    expect(state.settings.taskScrollThreshold).toBe(DEFAULT_SETTINGS.taskScrollThreshold);
    expect(state.notes).toEqual([]);
  });

  it('normalizes notes, rest days, shortcuts, and colors', () => {
    const state = normalizeAppState({
      notes: [{ id: 'note', text: '本机便签', completed: 1 }],
      settings: {
        bulletStyle: 'dot',
        restDays: [0, 6, 6, 12, -1],
        showHideShortcut: ' Control+Alt+H ',
        backgroundColor: 'not-a-color',
        taskBaseFontSize: 8,
        taskMinFontSize: 18,
      },
    });
    expect(state.notes[0].completed).toBe(true);
    expect(state.settings.bulletStyle).toBe('dot');
    expect(state.settings.autoNumber).toBe(false);
    expect(state.settings.restDays).toEqual([0, 6]);
    expect(state.settings.showHideShortcut).toBe('Control+Alt+H');
    expect(state.settings.backgroundColor).toBe(DEFAULT_SETTINGS.backgroundColor);
    expect(state.settings.taskMinFontSize).toBe(8);
  });

  it('normalizes editor input style and desktop icon layer', () => {
    const state = normalizeAppState({ settings: { editorInputStyle: 'multi-row', desktopIconLayer: 'above' } });
    expect(state.settings.editorInputStyle).toBe('multi-row');
    expect(state.settings.desktopIconLayer).toBe('above');
    const fallback = normalizeAppState({ settings: { editorInputStyle: 'grid', desktopIconLayer: 'top' } });
    expect(fallback.settings.editorInputStyle).toBe('one-box');
    expect(fallback.settings.desktopIconLayer).toBe('auto');
  });
});
