import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowRight, Check, Plus, Repeat2, Trash2, X } from 'lucide-react';
import { TASK_PALETTE } from '../lib/appearance';
import { fullDateLabel, toDateKey } from '../lib/date';
import { cancelTaskSeriesFrom, createTask, sortTasks } from '../lib/tasks';
import { DEFAULT_RECURRENCE, normalizeRecurrence, REPEAT_OPTIONS } from '../lib/recurrence';
import { clockTime, isTaskTimeRange, timeInMinutes } from '../lib/taskTime';
import { RecurrenceFields } from './RecurrenceFields';
import type { RecurrencePattern, Settings, Task, TaskColor, TaskRolloverMode } from '../types';

const ROLLOVER_OPTIONS: { value: TaskRolloverMode | undefined; label: string; short: string }[] = [
  { value: undefined, label: '跟随全局', short: '顺延' },
  { value: 'on', label: '单独开启', short: '顺延·开' },
  { value: 'off', label: '单独关闭', short: '顺延·关' },
];

const COLOR_OPTIONS: { value: TaskColor; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'mint', label: '薄荷' },
  { value: 'blue', label: '晴蓝' },
  { value: 'amber', label: '暖黄' },
  { value: 'rose', label: '绯红' },
  { value: 'violet', label: '雾紫' },
];

const LINE_PREFIX = /^\s*(?:\d+[.)、]\s*|•\s*)/;

function createEmptyTask(date: string): Task {
  return createTask(date);
}

function stripLinePrefix(line: string): string {
  return line.replace(LINE_PREFIX, '');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderLines(editor: HTMLElement, lines: string[]) {
  editor.innerHTML = lines.map((line) => `<div class="editor-line">${line ? escapeHtml(line) : '<br>'}</div>`).join('');
}

function readLines(editor: HTMLElement): string[] {
  const children = Array.from(editor.children);
  if (children.length === 0) return [editor.textContent ?? ''];
  return children.map((child) => (child.tagName === 'BR' ? '' : child.textContent ?? ''));
}

function selectionLineIndex(editor: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return -1;
  let node: Node | null = selection.anchorNode;
  if (!node) return -1;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const line = (node as HTMLElement | null)?.closest?.('.editor-line');
  if (!line) return -1;
  return Array.from(editor.children).indexOf(line);
}

function caretOffsetInLine(line: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!line.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(line);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function focusLineEnd(editor: HTMLElement, index: number) {
  const line = editor.children[index];
  if (!line) return;
  const range = document.createRange();
  range.selectNodeContents(line);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.focus();
}

function reconcileRows(previous: Task[], lines: string[], date: string): Task[] {
  if (previous.length === lines.length) {
    return lines.map((line, index) => ({ ...previous[index], title: line }));
  }
  const used = new Set<number>();
  return lines.map((line, index) => {
    const trimmed = line.trim();
    let match = -1;
    for (let i = 0; i < previous.length; i += 1) {
      if (!used.has(i) && previous[i].title.trim() === trimmed) {
        match = i;
        break;
      }
    }
    if (match >= 0) {
      used.add(match);
      return { ...previous[match], title: line };
    }
    const template = previous[Math.min(index, previous.length - 1)];
    return {
      ...createEmptyTask(date),
      title: line,
      repeat: template?.repeat ?? 'none',
      recurrence: template?.recurrence,
      color: template?.color ?? 'default',
    };
  });
}

interface DayEditorDialogProps {
  date: string;
  tasks: Task[];
  initialTaskId?: string;
  initialTime?: Pick<Task, 'time' | 'endTime'>;
  settings: Settings;
  onAutoSave: (tasks: Task[], managed: ReadonlySet<string>) => void;
  onSave: (tasks: Task[], managed: ReadonlySet<string>) => void;
  onCancelSeries: (seriesId: string, cutoff: string) => void;
  onClose: () => void;
}

const AUTO_SAVE_DELAY = 400;

function TaskTimeEditor({ task, onChange }: { task: Task; onChange: (patch: Partial<Task>) => void }) {
  const [invalid, setInvalid] = useState<{ start: string; end: string } | null>(null);
  const start = invalid?.start ?? task.time;
  const end = invalid?.end ?? task.endTime ?? '';

  function change(nextStart: string, nextEnd: string) {
    if (!isTaskTimeRange(nextStart, nextEnd)) {
      setInvalid({ start: nextStart, end: nextEnd });
      return;
    }
    setInvalid(null);
    onChange({ time: nextStart, endTime: nextEnd || undefined });
  }

  return <>
    <label>开始 <input type="time" value={start} aria-label="选中行开始时间" onChange={(event) => {
      const next = event.target.value;
      const nextEnd = !next ? '' : !start ? clockTime(timeInMinutes(next) + 60) : end;
      change(next, nextEnd);
    }} /></label>
    <label>结束 <input type="time" value={end} disabled={!start} aria-label="选中行结束时间" onChange={(event) => change(start, event.target.value)} /></label>
    {invalid && <span className="editor-time-message" role="status">起止不能相同</span>}
    {!invalid && start && end && end < start && <span className="editor-time-message">次日结束</span>}
    <button type="button" className="editor-clear-reminder" title="清空选中行的时间段与提醒"
      disabled={!start && !end} onClick={() => change('', '')}>清除提醒</button>
  </>;
}

export function DayEditorDialog({ date, tasks, initialTaskId, initialTime, settings, onAutoSave, onSave, onCancelSeries, onClose }: DayEditorDialogProps) {
  const initialRows = [...sortTasks(tasks, settings.completedToBottom), { ...createEmptyTask(date), ...initialTime }];
  const multiRow = settings.editorInputStyle === 'multi-row';
  const [rows, setRows] = useState<Task[]>(initialRows);
  const [text, setText] = useState(() => initialRows.map((row) => row.title).join('\n'));
  const [activeLine, setActiveLine] = useState(0);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showRollover, setShowRollover] = useState(false);
  const [customRepeat, setCustomRepeat] = useState<RecurrencePattern | null>(null);
  const [showColors, setShowColors] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const rowInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const selectedIndex = Math.min(activeLine, rows.length - 1);
  const selected = rows[selectedIndex] ?? rows[0];
  const rowsRef = useRef(rows);
  const managedIds = useRef(new Set(tasks.map(task => task.id)));
  const autoSaveRef = useRef(onAutoSave);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { autoSaveRef.current = onAutoSave; }, [onAutoSave]);

  function collectTasks(): Task[] {
    rowsRef.current.forEach(row => managedIds.current.add(row.id));
    return rowsRef.current.filter((row) => row.title.trim()).map((row) => ({ ...row, title: row.title.trim() }));
  }

  function flushAutoSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    autoSaveRef.current(collectTasks(), new Set(managedIds.current));
  }

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    dirtyRef.current = true;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      autoSaveRef.current(collectTasks(), new Set(managedIds.current));
    }, AUTO_SAVE_DELAY);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, text]);

  useEffect(() => () => flushAutoSave(), []);

  useEffect(() => {
    void window.desktop?.focusCalendarInput();
    const taskIndex = initialTaskId ? rows.findIndex((row) => row.id === initialTaskId) : -1;
    const lineIndex = taskIndex >= 0 ? taskIndex : rows.length - 1;
    setActiveLine(lineIndex);
    if (multiRow) {
      requestAnimationFrame(() => {
        const input = rowInputRefs.current[lineIndex];
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    renderLines(editor, text.split('\n'));
    editor.focus();
    focusLineEnd(editor, lineIndex);
    requestAnimationFrame(syncGutterHeights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    Array.from(editor.children).forEach((child, index) => {
      child.classList.toggle('is-completed', Boolean(rows[index]?.completed));
    });
    const frame = requestAnimationFrame(syncGutterHeights);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, text]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new ResizeObserver(() => syncGutterHeights());
    observer.observe(editor);
    window.addEventListener('resize', syncGutterHeights);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncGutterHeights);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (gutterRef.current && editorRef.current) gutterRef.current.scrollTop = editorRef.current.scrollTop;
  });

  function syncGutterHeights() {
    const editor = editorRef.current;
    const gutter = gutterRef.current;
    if (!editor || !gutter) return;
    Array.from(editor.children).forEach((line, index) => {
      const gutterLine = gutter.children[index] as HTMLElement | undefined;
      if (!gutterLine) return;
      gutterLine.style.height = `${(line as HTMLElement).getBoundingClientRect().height}px`;
    });
  }

  function commitLines(lines: string[], caretLine: number) {
    setText(lines.join('\n'));
    setRows((current) => reconcileRows(current, lines, date));
    setActiveLine(caretLine);
  }

  function syncActiveLine() {
    const editor = editorRef.current;
    if (!editor) return;
    const index = selectionLineIndex(editor);
    if (index >= 0) setActiveLine(index);
  }

  function onEditorInput() {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = readLines(editor);
    commitLines(lines, Math.max(0, selectionLineIndex(editor)));
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && event.shiftKey) event.preventDefault();
  }

  function onEditorPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData('text');
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const editor = editorRef.current;
    if (!editor) return;
    const lines = readLines(editor);
    const index = Math.max(0, selectionLineIndex(editor));
    const line = editor.children[index] as HTMLElement | undefined;
    const offset = line ? caretOffsetInLine(line) ?? (lines[index] ?? '').length : (lines[index] ?? '').length;
    const current = lines[index] ?? '';
    const inserted = pasted.replace(/\r\n/g, '\n').split('\n').map(stripLinePrefix);
    const merged = [
      current.slice(0, offset) + inserted[0],
      ...inserted.slice(1, -1),
      inserted[inserted.length - 1] + current.slice(offset),
    ];
    lines.splice(index, 1, ...merged);
    renderLines(editor, lines);
    const caretLine = index + merged.length - 1;
    focusLineEnd(editor, caretLine);
    commitLines(lines, caretLine);
  }

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...updates };
      if (updates.completed !== undefined && updates.completed !== row.completed) {
        next.completedAt = updates.completed ? new Date().toISOString() : undefined;
      }
      return next;
    }));
  }, []);

  useEffect(() => window.desktop?.onTaskMenuComplete(({ id, editing, completed }) => {
    if (editing) updateTask(id, { completed });
  }), [updateTask]);

  function updateSelected(updates: Partial<Task>) {
    if (selected) updateTask(selected.id, updates);
  }

  function openTaskMenu(event: MouseEvent<HTMLElement>, index: number, hasSelection: boolean) {
    const row = rows[index];
    if (!window.desktop || !row?.title.trim()) return;
    event.preventDefault();
    setActiveLine(index);
    window.desktop.showTaskMenu({ id: row.id, x: event.clientX, y: event.clientY, editing: true, completed: row.completed, hasSelection });
  }

  function focusRow(index: number) {
    requestAnimationFrame(() => {
      const input = rowInputRefs.current[index];
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function updateRowTitle(index: number, title: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, title } : row));
  }

  function insertRowAfter(index: number) {
    const target = Math.max(0, Math.min(index, rows.length - 1));
    setRows((current) => {
      const next = [...current];
      next.splice(target + 1, 0, createEmptyTask(date));
      return next;
    });
    setActiveLine(target + 1);
    focusRow(target + 1);
  }

  function removeRow(index: number) {
    const target = Math.max(0, Math.min(index, rows.length - 1));
    if (rows.length === 1) {
      updateRowTitle(0, '');
      setActiveLine(0);
      focusRow(0);
      return;
    }
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== target));
    const nextIndex = Math.max(0, target - 1);
    setActiveLine(nextIndex);
    focusRow(nextIndex);
  }

  function onRowKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      insertRowAfter(index);
      return;
    }
    if (event.key === 'Backspace' && !rows[index]?.title && rows.length > 1) {
      event.preventDefault();
      removeRow(index);
    }
  }

  function onRowPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text');
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const row = rows[index];
    if (!row) return;
    const input = event.currentTarget;
    const start = input.selectionStart ?? row.title.length;
    const end = input.selectionEnd ?? start;
    const lines = pasted.replace(/\r\n/g, '\n').split('\n').map(stripLinePrefix);
    const merged = [
      row.title.slice(0, start) + lines[0],
      ...lines.slice(1, -1),
      lines[lines.length - 1] + row.title.slice(end),
    ];
    setRows((current) => {
      const next = [...current];
      const template = current[index];
      next.splice(index, 1, ...merged.map((title, offset) => offset === 0
        ? { ...(template ?? createEmptyTask(date)), title }
        : { ...createEmptyTask(date), title, repeat: template?.repeat ?? 'none', recurrence: template?.recurrence, color: template?.color ?? 'default' }));
      return next;
    });
    setActiveLine(index + merged.length - 1);
    focusRow(index + merged.length - 1);
  }

  function insertLine() {
    if (multiRow) {
      insertRowAfter(selectedIndex);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const lines = readLines(editor);
    lines.push('');
    renderLines(editor, lines);
    focusLineEnd(editor, lines.length - 1);
    commitLines(lines, lines.length - 1);
  }

  function cancelSeries() {
    const today = toDateKey();
    const cutoff = date < today ? today : date;
    if (!window.confirm('将移除自 ' + cutoff + ' 起的未完成重复条目，保留此前记录和已完成条目。确定取消重复？')) return;
    const seriesId = selected.seriesId ?? selected.id;
    const remaining = cancelTaskSeriesFrom(rows, seriesId, cutoff);
    const next = remaining.length ? remaining : [createEmptyTask(date)];
    const lines = next.map(row => row.title);
    const index = Math.min(selectedIndex, next.length - 1);
    rowsRef.current = next;
    setRows(next);
    setText(lines.join('\n'));
    setActiveLine(index);
    const editor = editorRef.current;
    if (editor) {
      renderLines(editor, lines);
      editor.focus();
      focusLineEnd(editor, index);
    } else focusRow(index);
    onCancelSeries(seriesId, cutoff);
  }

  function removeSelectedLine() {
    if (multiRow) {
      removeRow(selectedIndex);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const lines = readLines(editor);
    const index = Math.min(selectedIndex, lines.length - 1);
    if (lines.length === 1) {
      lines[0] = '';
      renderLines(editor, lines);
      focusLineEnd(editor, 0);
      commitLines(lines, 0);
      return;
    }
    lines.splice(index, 1);
    const target = Math.max(0, index - 1);
    renderLines(editor, lines);
    focusLineEnd(editor, target);
    commitLines(lines, target);
  }

  function save() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current = false;
    const tasksToSave = sortTasks(collectTasks(), settings.completedToBottom);
    onSave(tasksToSave, new Set(managedIds.current));
  }

  const editorStyle = {
    '--editor-font-family': settings.editorFontFamily,
    '--editor-font-size': `${settings.editorFontSize}px`,
    '--editor-text-color': settings.editorTextColor,
  } as CSSProperties;

  return (
    <div className="modal-backdrop day-editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="day-editor" style={editorStyle} role="dialog" aria-modal="true" aria-labelledby="day-editor-title" onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('input, textarea, [contenteditable]')) void window.desktop?.focusCalendarInput();
      }}>
        <header className="day-editor-header">
          <div>
            <span className="eyebrow">DAILY NOTES</span>
            <h2 id="day-editor-title">{fullDateLabel(date)}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭编辑器"><X size={17} /></button>
          <button className="editor-save" type="button" onClick={save} aria-label="保存并关闭" title="保存并关闭"><Check size={19} /></button>
        </header>

        <div className={`editor-textbox ${multiRow ? 'is-multi-row' : ''}`}>
          {multiRow ? (
            <div className="editor-rows">
              {rows.map((row, index) => (
                <div className={`editor-row ${index === selectedIndex ? 'is-active' : ''} ${row.completed ? 'is-completed' : ''}`} key={row.id}>
                  <span className="editor-row-mark" data-color={row.color} />
                  <span className="editor-row-number">{settings.bulletStyle === 'number' ? `${index + 1}.` : settings.bulletStyle === 'dot' ? '•' : ''}</span>
                  <span className="editor-row-repeat">{row.repeat !== 'none' && <Repeat2 size={10} />}</span>
                  <input
                    className="editor-row-input"
                    ref={(element) => { rowInputRefs.current[index] = element; }}
                    value={row.title}
                    placeholder={index === rows.length - 1 && !row.title ? '输入日程，Enter 新增' : ''}
                    aria-label={`第 ${index + 1} 项日程`}
                    spellCheck={false}
                    onChange={(event) => updateRowTitle(index, event.target.value)}
                    onFocus={() => setActiveLine(index)}
                    onClick={() => setActiveLine(index)}
                    onContextMenu={event => openTaskMenu(event, index, event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)}
                    onKeyDown={(event) => onRowKeyDown(index, event)}
                    onPaste={(event) => onRowPaste(index, event)}
                  />
                </div>
              ))}
            </div>
          ) : <>
            <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
              {rows.map((row, index) => (
                <div
                  className={`editor-gutter-line ${index === selectedIndex ? 'is-active' : ''} ${row.completed ? 'is-completed' : ''}`}
                  key={`${row.id}-${index}`}
                >
                  <span className="editor-gutter-mark" data-color={row.color} />
                  <span className="editor-gutter-number">{settings.bulletStyle === 'number' ? `${index + 1}.` : settings.bulletStyle === 'dot' ? '•' : ''}</span>
                  <span className="editor-gutter-repeat">{row.repeat !== 'none' && <Repeat2 size={10} />}</span>
                </div>
              ))}
            </div>
            <div
              className="editor-textarea"
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="当天日程，每行一项"
              data-empty={text.trim() ? 'false' : 'true'}
              data-placeholder="输入日程，Enter 换行"
              spellCheck={false}
              onInput={onEditorInput}
              onKeyDown={onEditorKeyDown}
              onKeyUp={syncActiveLine}
              onClick={syncActiveLine}
              onContextMenu={event => {
                const line = (event.target as HTMLElement).closest('.editor-line');
                const index = line ? Array.from(event.currentTarget.children).indexOf(line) : selectedIndex;
                openTaskMenu(event, index, window.getSelection()?.isCollapsed === false);
              }}
              onPaste={onEditorPaste}
              onScroll={() => {
                if (gutterRef.current && editorRef.current) gutterRef.current.scrollTop = editorRef.current.scrollTop;
              }}
            />
          </>}
        </div>

        <div className="editor-selected-meta">
          {selected && <TaskTimeEditor key={selected.id} task={selected} onChange={updateSelected} />}
          <span className="editor-line-count">{rows.filter((row) => row.title.trim()).length} 行</span>
        </div>

        <footer className="editor-toolbar">
          <button
            type="button"
            className={selected?.completed ? 'is-active' : ''}
            onClick={() => updateSelected({ completed: !selected?.completed })}
          ><Check size={15} /><span>{selected?.completed ? '恢复' : '完成'}</span></button>

          <div className="editor-tool-wrap">
            <button type="button" className={selected?.repeat !== 'none' ? 'is-active' : ''} onClick={() => { setShowRepeat(!showRepeat); setCustomRepeat(null); setShowColors(false); setShowRollover(false); }}>
              <Repeat2 size={15} /><span>{REPEAT_OPTIONS.find((option) => option.value === selected?.repeat)?.label ?? '不重复'}</span>
            </button>
            {showRepeat && (
              <div className={`editor-popover repeat-popover ${customRepeat ? 'repeat-popover-custom' : ''}`}>
                {customRepeat ? <>
                  <RecurrenceFields date={date} value={customRepeat} onChange={setCustomRepeat} />
                  <div className="recurrence-actions">
                    <button type="button" onClick={() => setCustomRepeat(null)}>返回</button>
                    <button type="button" disabled={!normalizeRecurrence(customRepeat)
                      || (customRepeat.end.type === 'until' && customRepeat.end.date < date)} onClick={() => {
                      const recurrence = normalizeRecurrence(customRepeat);
                      if (!recurrence) return;
                      updateSelected({ repeat: 'custom', recurrence });
                      setShowRepeat(false);
                      setCustomRepeat(null);
                    }}>应用规则</button>
                  </div>
                </> : REPEAT_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={selected?.repeat === option.value ? 'is-active' : ''}
                    onClick={() => {
                      if (option.value === 'custom') {
                        setCustomRepeat(selected?.recurrence ?? DEFAULT_RECURRENCE);
                        return;
                      }
                      setShowRepeat(false);
                      if (option.value === 'none' && selected?.repeat !== 'none') {
                        cancelSeries();
                        return;
                      }
                      updateSelected({ repeat: option.value, recurrence: undefined, recurrenceStart: undefined, recurrenceExcludedDates: undefined });
                    }}
                  >{option.label}{selected?.repeat === option.value && <Check size={12} />}</button>
                ))}
              </div>
            )}
          </div>

          <div className="editor-tool-wrap">
            <button type="button" aria-label="选中行顺延" aria-expanded={showRollover} className={selected?.rolloverMode ? 'is-active' : ''} onClick={() => {
              setShowRollover(!showRollover);
              setShowRepeat(false);
              setShowColors(false);
            }}><ArrowRight size={15} /><span>{ROLLOVER_OPTIONS.find(option => option.value === selected?.rolloverMode)?.short}</span></button>
            {showRollover && <div className="editor-popover repeat-popover">
              {ROLLOVER_OPTIONS.map(({ value, label }) => <button key={label} type="button" className={value === selected?.rolloverMode ? 'is-active' : ''} onClick={() => {
                updateSelected({ rolloverMode: value });
                setShowRollover(false);
              }}>{label}{value === selected?.rolloverMode && <Check size={12} />}</button>)}
            </div>}
          </div>

          <div className="editor-tool-wrap">
            <button type="button" aria-expanded={showColors} onClick={() => { setShowColors(!showColors); setShowRepeat(false); setShowRollover(false); }}>
              <span className="toolbar-color" data-color={selected?.color ?? 'default'} style={{ backgroundColor: selected?.cardColor }} />颜色
            </button>
            {showColors && (
              <div className="editor-popover color-popover" role="group" aria-label="日程颜色">
                <div className="editor-color-presets">{COLOR_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    aria-label={option.label}
                    title={option.label}
                    aria-pressed={!selected?.cardColor && selected?.color === option.value}
                    className={!selected?.cardColor && selected?.color === option.value ? 'is-active' : ''}
                    onClick={() => {
                      updateSelected({ color: option.value, cardColor: undefined });
                      setShowColors(false);
                    }}
                  ><span style={{ background: TASK_PALETTE[option.value] }} /></button>
                ))}</div>
                <label className="editor-custom-color">
                  <span>日／周卡片背景</span>
                  <input type="color" aria-label="日／周卡片背景"
                    value={selected?.cardColor ?? TASK_PALETTE[selected?.color ?? 'default']}
                    onChange={event => updateSelected({ cardColor: event.target.value })} />
                </label>
                {selected?.cardColor && <button className="editor-reset-color" type="button"
                  onClick={() => updateSelected({ cardColor: undefined })}>恢复预设</button>}
              </div>
            )}
          </div>

          <button type="button" onClick={insertLine}><Plus size={15} /><span>新行</span></button>
          <button type="button" className="editor-delete" onClick={removeSelectedLine}><Trash2 size={15} /><span>删除</span></button>
          <span className="editor-hint">{multiRow ? 'Enter 新增一行' : 'Enter 换行'} · 自动保存</span>
        </footer>
      </section>
    </div>
  );
}
