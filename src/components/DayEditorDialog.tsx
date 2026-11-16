import { useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, Plus, Repeat2, Trash2, X } from 'lucide-react';
import { fullDateLabel } from '../lib/date';
import { sortTasks } from '../lib/tasks';
import type { RepeatRule, Settings, Task, TaskColor } from '../types';

const REPEAT_OPTIONS: { value: RepeatRule; label: string }[] = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
];

const COLOR_OPTIONS: { value: TaskColor; label: string; color: string }[] = [
  { value: 'default', label: '默认', color: '#a9c2b5' },
  { value: 'mint', label: '薄荷', color: '#9fd7b5' },
  { value: 'blue', label: '晴蓝', color: '#91c6e5' },
  { value: 'amber', label: '暖黄', color: '#e2be83' },
  { value: 'rose', label: '绯红', color: '#dfa19e' },
  { value: 'violet', label: '雾紫', color: '#b9a9dc' },
];

function createEmptyTask(date: string): Task {
  return {
    id: crypto.randomUUID(),
    title: '',
    notes: '',
    date,
    time: '',
    completed: false,
    createdAt: new Date().toISOString(),
    originalDate: date,
    rolloverCount: 0,
    repeat: 'none',
    color: 'default',
  };
}

interface DayEditorDialogProps {
  date: string;
  tasks: Task[];
  initialTaskId?: string;
  settings: Settings;
  onSave: (tasks: Task[]) => void;
  onClose: () => void;
}

export function DayEditorDialog({ date, tasks, initialTaskId, settings, onSave, onClose }: DayEditorDialogProps) {
  const [rows, setRows] = useState<Task[]>(() => [...sortTasks(tasks, settings.completedToBottom), createEmptyTask(date)]);
  const [selectedId, setSelectedId] = useState(initialTaskId ?? tasks[0]?.id ?? rows[0].id);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];

  function focusRow(id: string) {
    window.setTimeout(() => {
      const input = inputs.current.get(id);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }

  function updateRow(id: string, updates: Partial<Task>) {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...updates };
      if (updates.completed !== undefined && updates.completed !== row.completed) {
        next.completedAt = updates.completed ? new Date().toISOString() : undefined;
      }
      return next;
    }));
  }

  function insertRow(index: number) {
    const newTask = createEmptyTask(date);
    setRows((current) => {
      const next = [...current];
      next.splice(index + 1, 0, newTask);
      return next;
    });
    setSelectedId(newTask.id);
    focusRow(newTask.id);
  }

  function removeRow(id: string) {
    const index = rows.findIndex((row) => row.id === id);
    if (rows.length === 1) {
      setRows([createEmptyTask(date)]);
      return;
    }
    const next = rows.filter((row) => row.id !== id);
    setRows(next);
    const nextSelected = next[Math.max(0, index - 1)];
    setSelectedId(nextSelected.id);
    focusRow(nextSelected.id);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      insertRow(index);
    }
    if (event.key === 'Backspace' && !rows[index].title && rows.length > 1) {
      event.preventDefault();
      removeRow(rows[index].id);
    }
  }

  function onRowPaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const text = event.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    event.preventDefault();
    const input = event.currentTarget;
    const row = rows[index];
    const start = input.selectionStart ?? row.title.length;
    const end = input.selectionEnd ?? start;
    const lines = `${row.title.slice(0, start)}${text}${row.title.slice(end)}`.split(/\r?\n/);
    const replacements = lines.map((title, lineIndex) => lineIndex === 0 ? { ...row, title } : {
      ...createEmptyTask(date),
      title,
      repeat: row.repeat,
      color: row.color,
    });
    setRows((current) => [...current.slice(0, index), ...replacements, ...current.slice(index + 1)]);
    const last = replacements[replacements.length - 1];
    setSelectedId(last.id);
    focusRow(last.id);
  }

  function save() {
    const editedTasks = rows.filter((row) => row.title.trim()).map((row) => ({ ...row, title: row.title.trim() }));
    onSave(sortTasks(editedTasks, settings.completedToBottom));
  }

  const editorStyle = {
    '--editor-font-family': settings.editorFontFamily,
    '--editor-font-size': `${settings.editorFontSize}px`,
    '--editor-text-color': settings.editorTextColor,
  } as CSSProperties;

  return (
    <div className="modal-backdrop day-editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="day-editor" style={editorStyle} role="dialog" aria-modal="true" aria-labelledby="day-editor-title">
        <header className="day-editor-header">
          <div>
            <span className="eyebrow">DAILY NOTES</span>
            <h2 id="day-editor-title">{fullDateLabel(date)}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭编辑器"><X size={17} /></button>
          <button className="editor-save" type="button" onClick={save} aria-label="保存当天日程" title="保存"><Check size={19} /></button>
        </header>

        <div className="editor-rows">
          {rows.map((row, index) => (
            <div
              className={`editor-row ${row.id === selected?.id ? 'is-selected' : ''} ${row.completed ? 'is-completed' : ''}`}
              key={row.id}
              data-color={row.color}
              onClick={() => setSelectedId(row.id)}
            >
              <span className="editor-row-number">{settings.bulletStyle === 'number' ? `${index + 1}.` : settings.bulletStyle === 'dot' ? '•' : ''}</span>
              <span className="editor-color-mark" />
              <input
                ref={(element) => {
                  if (element) inputs.current.set(row.id, element);
                  else inputs.current.delete(row.id);
                }}
                value={row.title}
                aria-label={`第 ${index + 1} 行日程`}
                placeholder={index === rows.length - 1 ? '输入日程，Enter 换行' : ''}
                onChange={(event) => updateRow(row.id, { title: event.target.value })}
                onKeyDown={(event) => onRowKeyDown(event, index)}
                onPaste={(event) => onRowPaste(event, index)}
                onFocus={() => setSelectedId(row.id)}
              />
              {row.repeat !== 'none' && <Repeat2 className="editor-repeat-mark" size={12} />}
            </div>
          ))}
        </div>

        <div className="editor-selected-meta">
          <span>选中行时间</span>
          <input
            type="time"
            value={selected?.time ?? ''}
            aria-label="选中行时间"
            onChange={(event) => selected && updateRow(selected.id, { time: event.target.value })}
          />
          <span className="editor-line-count">{rows.filter((row) => row.title.trim()).length} 行</span>
        </div>

        <footer className="editor-toolbar">
          <button
            type="button"
            className={selected?.completed ? 'is-active' : ''}
            onClick={() => selected && updateRow(selected.id, { completed: !selected.completed })}
          ><Check size={15} /><span>{selected?.completed ? '恢复' : '完成'}</span></button>

          <div className="editor-tool-wrap">
            <button type="button" className={selected?.repeat !== 'none' ? 'is-active' : ''} onClick={() => { setShowRepeat(!showRepeat); setShowColors(false); }}>
              <Repeat2 size={15} /><span>{REPEAT_OPTIONS.find((option) => option.value === selected?.repeat)?.label ?? '不重复'}</span>
            </button>
            {showRepeat && (
              <div className="editor-popover repeat-popover">
                {REPEAT_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={selected?.repeat === option.value ? 'is-active' : ''}
                    onClick={() => {
                      if (selected) updateRow(selected.id, { repeat: option.value });
                      setShowRepeat(false);
                    }}
                  >{option.label}{selected?.repeat === option.value && <Check size={12} />}</button>
                ))}
              </div>
            )}
          </div>

          <div className="editor-tool-wrap">
            <button type="button" onClick={() => { setShowColors(!showColors); setShowRepeat(false); }}>
              <span className="toolbar-color" data-color={selected?.color ?? 'default'} />颜色
            </button>
            {showColors && (
              <div className="editor-popover color-popover">
                {COLOR_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    aria-label={option.label}
                    title={option.label}
                    className={selected?.color === option.value ? 'is-active' : ''}
                    onClick={() => {
                      if (selected) updateRow(selected.id, { color: option.value });
                      setShowColors(false);
                    }}
                  ><span style={{ background: option.color }} /></button>
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={() => insertRow(rows.length - 1)}><Plus size={15} /><span>新行</span></button>
          <button type="button" className="editor-delete" onClick={() => selected && removeRow(selected.id)}><Trash2 size={15} /><span>删除</span></button>
          <span className="editor-hint">Enter 换行</span>
        </footer>
      </section>
    </div>
  );
}
