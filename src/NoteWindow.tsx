import { Plus, StickyNote as StickyNoteIcon, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { NoteStatePayload } from './types';

const NOTE_HEIGHT_PADDING = 8;
const NOTE_TEXTAREA_MAX_HEIGHT = 420;

export default function NoteWindow() {
  const noteId = new URLSearchParams(window.location.search).get('id') ?? '';
  const [data, setData] = useState<NoteStatePayload | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const editingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const desktop = window.desktop;

  useEffect(() => {
    if (!desktop || !noteId) return;
    desktop.noteReady(noteId);
    return desktop.onNoteState((payload) => {
      if (!payload || !payload.note || payload.note.id !== noteId) return;
      setData((current) => editingRef.current && current
        ? { ...payload, note: { ...payload.note, text: current.note.text } }
        : payload);
    });
  }, [desktop, noteId]);

  useEffect(() => {
    if (!desktop) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) void desktop.beginInput();
    };
    const onPointerDown = () => void desktop.focusWindow();
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [desktop]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(NOTE_TEXTAREA_MAX_HEIGHT, Math.max(72, textarea.scrollHeight))}px`;
  }, [data?.note.text, data?.appearance.noteFontFamily, data?.appearance.noteFontSize]);

  useEffect(() => {
    if (!desktop || !data || !noteId) return;
    const panel = panelRef.current;
    if (!panel) return;
    const report = () => desktop.resizeNoteWindow(noteId, Math.ceil(panel.getBoundingClientRect().height) + NOTE_HEIGHT_PADDING);
    const observer = new ResizeObserver(report);
    observer.observe(panel);
    report();
    const timer = window.setTimeout(report, 120);
    window.addEventListener('resize', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('resize', report);
      document.removeEventListener('visibilitychange', report);
    };
  }, [data !== null, desktop, noteId]);

  useEffect(() => {
    if (!dragging || !desktop) return;
    const finish = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      desktop.endNoteDrag(noteId);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [desktop, dragging, noteId]);

  if (!data || !noteId) return null;

  const { note, appearance } = data;
  const alpha = Math.round(appearance.noteOpacity / 100 * 255).toString(16).padStart(2, '0');
  const style = {
    '--note-background': `${appearance.backgroundColor}${alpha}`,
    '--note-color': appearance.noteTextColor,
    '--note-font-family': appearance.noteFontFamily,
    '--note-font-size': `${appearance.noteFontSize}px`,
    '--note-row-gap': `${appearance.noteRowGap}px`,
  } as CSSProperties;

  function update(patch: { text?: string; completed?: boolean }) {
    setData((current) => current ? { ...current, note: { ...current.note, ...patch } } : current);
    desktop?.sendNoteChange(noteId, patch);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!desktop || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    desktop.startNoteDrag(noteId);
  }

  return (
    <div className={`note-window-root ${dragging ? 'is-dragging' : ''}`}>
      <aside ref={panelRef} className="notes-panel note-window-panel" style={style} aria-label="桌面便签">
        <header title="按住拖动便签" onPointerDown={startDrag}>
          <StickyNoteIcon size={15} />
          <strong>便签</strong>
          <button type="button" aria-label="新建便签" title="新建便签" onClick={() => desktop?.newNote()}><Plus size={15} /></button>
          <button type="button" aria-label="删除便签" title="删除便签" onClick={() => { if (window.confirm('删除这条便签？')) desktop?.deleteNote(noteId); }}><Trash2 size={14} /></button>
          <button type="button" aria-label="关闭便签" title="关闭便签（内容保留）" onClick={() => desktop?.closeNote(noteId)}><X size={15} /></button>
        </header>
        <div className="note-window-body">
          <div className={`sticky-note ${note.completed ? 'is-completed' : ''}`} data-background={appearance.noteTextBackground}>
            {appearance.showNoteCheckbox && <input type="checkbox" aria-label="完成便签" checked={note.completed} onChange={(event) => update({ completed: event.target.checked })} />}
            <textarea
              ref={textareaRef}
              aria-label="便签内容"
              value={note.text}
              placeholder="写点什么…"
              rows={1}
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              onChange={(event) => update({ text: event.target.value })}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}