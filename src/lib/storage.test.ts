import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeAppState } from './storage';

describe('state normalization', () => {
  it('loads the new editor defaults, migrates note recall, and normalizes pinned shortcuts and subtasks', () => {
    const fresh = normalizeAppState({});
    expect(fresh.settings).toMatchObject({ editorEnterSaves: true, showTaskDetails: true, showNotesOnTaskbar: true, toggleNotesShortcut: 'Control+Alt+B' });
    const data = normalizeAppState({ settings: { settingsRevision: 3, toggleNotesShortcut: '', pinnedToolbarActions: ['today', 'unknown', 'today', 'draw'], editorEnterSaves: false },
      tasks: [{ id: 'task', date: '2026-11-25', title: '任务', notes: '旧备注', subtasks: [{ id: 'sub', title: '子任务', completed: true }, null] }] });
    expect(data.settings).toMatchObject({ editorEnterSaves: false, pinnedToolbarActions: ['today', 'draw'], toggleNotesShortcut: 'Control+Alt+B' });
    expect(data.tasks[0]).toMatchObject({ notes: '旧备注', subtasks: [{ id: 'sub', title: '子任务', completed: true }] });
    expect(normalizeAppState({ settings: { ...data.settings, toggleNotesShortcut: '', showNotesOnTaskbar: false } }).settings)
      .toMatchObject({ toggleNotesShortcut: '', showNotesOnTaskbar: false });
  });

  it('migrates the note italic toggle to the task text style dropdown', () => {
    expect(normalizeAppState({}).settings.taskTextStyle).toBe('italic-notes');
    expect(normalizeAppState({ settings: { taskNotesItalic: false } }).settings.taskTextStyle).toBe('normal-notes');
    expect(normalizeAppState({ settings: { taskNotesItalic: false, taskTextStyle: 'bold-title' } }).settings.taskTextStyle).toBe('bold-title');
    expect(normalizeAppState({ settings: { taskTextStyle: 'unrecognized' } }).settings.taskTextStyle).toBe('italic-notes');
  });

  it('defaults to month with the view switch shown and preserves explicit view preferences', () => {
    const defaults = normalizeAppState({ settings: {} }).settings;
    expect(defaults).toMatchObject({ calendarView: 'month', showCalendarViewSwitch: true, currentTimeLineColor: '#ff8d87' });
    const saved = normalizeAppState({ settings: { calendarView: 'week', showCalendarViewSwitch: false, currentTimeLineColor: '#16C7A9' } }).settings;
    expect(saved).toMatchObject({ calendarView: 'week', showCalendarViewSwitch: false, currentTimeLineColor: '#16C7A9' });
    expect(normalizeAppState({ settings: { currentTimeLineColor: 'red' } }).settings.currentTimeLineColor).toBe('#ff8d87');
  });

  it('migrates a shared time-axis switch and preserves independent view settings', () => {
    const defaults = normalizeAppState({ settings: {} }).settings;
    expect(defaults).toMatchObject({ showTimeAxis: false, showWeekTimeAxis: false, showDayTimeAxis: false });
    const legacy = normalizeAppState({ settings: { showTimeAxis: true } }).settings;
    expect(legacy).toMatchObject({ showTimeAxis: true, showWeekTimeAxis: true, showDayTimeAxis: true });
    const perView = normalizeAppState({ settings: { ...legacy, showTimeAxis: false, showDayTimeAxis: false } }).settings;
    expect(perView).toMatchObject({ showTimeAxis: false, showWeekTimeAxis: true, showDayTimeAxis: false });
  });

  it('inherits legacy task sizes and preserves independent day and week font limits', () => {
    const legacy = normalizeAppState({ settings: { taskBaseFontSize: 14, taskMinFontSize: 9 } }).settings;
    expect(legacy).toMatchObject({ dayTaskBaseFontSize: 14, dayTaskMinFontSize: 9, weekTaskBaseFontSize: 14, weekTaskMinFontSize: 9 });
    const saved = normalizeAppState({ settings: { ...legacy, dayTaskBaseFontSize: 8, dayTaskMinFontSize: 12, weekTaskMinFontSize: 11 } }).settings;
    expect(saved).toMatchObject({ taskBaseFontSize: 14, taskMinFontSize: 9, dayTaskBaseFontSize: 8, dayTaskMinFontSize: 8, weekTaskBaseFontSize: 14, weekTaskMinFontSize: 11 });
  });

  it('preserves legacy drawing images as editable-note attachments', () => {
    const notes = normalizeAppState({ notes: [{ id: 'legacy-drawing', text: '', image: 'data:image/png;base64,AAAA' },
      { id: 'mixed', text: 'Caption', images: [{ id: 'photo', src: 'data:image/jpeg;base64,BBBB' }, { id: 'bad', src: 'https://example.invalid/pic' }] }] }).notes;
    expect(notes[0]).toMatchObject({ images: [{ id: 'legacy-drawing', src: 'data:image/png;base64,AAAA' }] });
    expect(notes[0]).not.toHaveProperty('image');
    expect(notes[1]).toMatchObject({ text: 'Caption', images: [{ id: 'photo', src: 'data:image/jpeg;base64,BBBB' }] });
  });

  it('round-trips custom schedule card colors and ignores invalid legacy values', () => {
    const state = normalizeAppState({ tasks: [
      { id: 'custom', date: '2026-11-25', title: 'Custom', color: 'mint', cardColor: '#123ABC' },
      { id: 'legacy', date: '2026-11-25', title: 'Legacy', color: 'blue' },
      { id: 'invalid', date: '2026-11-25', title: 'Invalid', cardColor: 'red' },
    ] });
    expect(state.tasks[0]).toMatchObject({ color: 'mint', cardColor: '#123ABC' });
    expect(state.tasks[1]).not.toHaveProperty('cardColor');
    expect(state.tasks[2]).not.toHaveProperty('cardColor');
    expect(normalizeAppState(JSON.parse(JSON.stringify(state))).tasks).toEqual(state.tasks);
  });

  it('preserves legacy single times and valid overnight ranges without inventing end times', () => {
    const state = normalizeAppState({ tasks: [
      { id: 'legacy', title: '旧提醒', date: '2026-11-25', time: '08:15' },
      { id: 'night', title: '夜间测试', date: '2026-11-25', time: '23:30', endTime: '01:00' },
      { id: 'invalid', title: '旧空白', date: '2026-11-25', time: '', endTime: '01:00' },
    ] });
    expect(state.tasks[0]).toMatchObject({ time: '08:15' });
    expect(state.tasks[0]).not.toHaveProperty('endTime');
    expect(state.tasks[1]).toMatchObject({ time: '23:30', endTime: '01:00' });
    expect(state.tasks[2]).not.toHaveProperty('endTime');
    expect(normalizeAppState(JSON.parse(JSON.stringify(state))).tasks).toEqual(state.tasks);
  });

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
    expect(fallback.settings.desktopIconLayer).toBe('below');
  });

  it('migrates the legacy auto icon layer to below only once', () => {
    const legacy = normalizeAppState({ settings: { desktopIconLayer: 'auto' } });
    expect(legacy.settings.desktopIconLayer).toBe('below');
    expect(legacy.settings.settingsRevision).toBe(DEFAULT_SETTINGS.settingsRevision);

    const explicit = normalizeAppState({ settings: { desktopIconLayer: 'auto', settingsRevision: 2 } });
    expect(explicit.settings.desktopIconLayer).toBe('below');

    const above = normalizeAppState({ settings: { desktopIconLayer: 'above' } });
    expect(above.settings.desktopIconLayer).toBe('above');
    expect(above.settings.settingsRevision).toBe(DEFAULT_SETTINGS.settingsRevision);
  });

  it('opens legacy notes only when the old notes panel was visible', () => {
    const visible = normalizeAppState({ notes: [{ id: 'a', text: 'A' }], settings: { showNotes: true } });
    expect(visible.notes[0].open).toBe(true);

    const hidden = normalizeAppState({ notes: [{ id: 'b', text: 'B' }], settings: { showNotes: false } });
    expect(hidden.notes[0].open).toBe(false);

    const explicit = normalizeAppState({ notes: [{ id: 'c', text: 'C', open: false }], settings: { showNotes: true, settingsRevision: 3 } });
    expect(explicit.notes[0].open).toBe(false);
  });

  it('normalizes rollover highlight and ghost settings', () => {
    const state = normalizeAppState({ settings: { rolloverHighlightEnabled: true, rolloverHighlightColor: '#123456', rolloverGhostEnabled: true } });
    expect(state.settings.rolloverHighlightEnabled).toBe(true);
    expect(state.settings.rolloverHighlightColor).toBe('#123456');
    expect(state.settings.rolloverGhostEnabled).toBe(true);

    const fallback = normalizeAppState({ settings: { rolloverHighlightColor: 'red' } });
    expect(fallback.settings.rolloverHighlightColor).toBe(DEFAULT_SETTINGS.rolloverHighlightColor);
    expect(fallback.settings.rolloverHighlightEnabled).toBe(false);
    expect(fallback.settings.rolloverGhostEnabled).toBe(false);
  });
});
