import { Palette, Plus, Strikethrough, StickyNote as StickyNoteIcon, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import type { NoteFormat, NotePatch, NoteStatePayload } from './types';
import { NOTE_COLORS, cleanNoteHtml, noteCheckHtml, setNoteCheck } from './lib/noteFormat';

const NOTE_HEIGHT_PADDING = 8;

export default function NoteWindow() {
  const noteId = new URLSearchParams(window.location.search).get('id') ?? '';
  const [data, setData] = useState<NoteStatePayload | null>(null);
  const dragging = useRef<number | null>(null);
  const editingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const formatRange = useRef<Range | null>(null);
  const shownContent = useRef<{ text: string; richText?: string } | null>(null);
  const noteText = data?.note.text;
  const richText = data?.note.richText;
  const defaultColor = data?.appearance.noteTextColor;
  const desktop = window.desktop;

  useEffect(() => {
    if (!desktop || !noteId) return;
    let active = true;
    const receive = (payload: NoteStatePayload | null) => {
      if (!active || !payload || payload.note.id !== noteId) return;
      setData((current) => editingRef.current && current
        ? { ...payload, note: { ...payload.note, text: current.note.text, richText: current.note.richText } }
        : payload);
    };
    const unsubscribe = desktop.onNoteState(receive);
    void desktop.noteReady(noteId).then(receive).catch(console.error);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop, noteId]);

  const update = useCallback((patch: NotePatch) => {
    setData((current) => current ? { ...current, note: { ...current.note, ...patch } } : current);
    desktop?.sendNoteChange(noteId, patch);
  }, [desktop, noteId]);

  const saveContent = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = editor.innerText.replaceAll('\u00a0', ' ');
    const patch = { text, richText: cleanNoteHtml(editor.innerHTML) };
    shownContent.current = patch;
    editor.dataset.empty = String(!text.trim());
    update(patch);
  }, [update]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || noteText === undefined) return;
    if (shownContent.current?.text === noteText && shownContent.current.richText === richText) return;
    if (richText === undefined) editor.textContent = noteText;
    else editor.innerHTML = cleanNoteHtml(richText);
    editor.dataset.empty = String(!noteText.trim());
    shownContent.current = { text: noteText, richText };
  }, [noteText, richText]);

  const applyFormat = useCallback((format: NoteFormat) => {
    const editor = editorRef.current;
    const range = formatRange.current;
    if (!editor || (format.type !== 'checkbox' && (!range || range.collapsed))) return;

    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (range && selection && editor.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (format.type === 'checkbox') {
      selection?.collapseToEnd();
      document.execCommand('insertHTML', false, noteCheckHtml(false) + '&nbsp;');
    } else if (format.type === 'strike') {
      document.execCommand('strikeThrough');
    } else if (format.type === 'color') {
      document.execCommand('foreColor', false, format.color || defaultColor);
    }
    saveContent();
  }, [defaultColor, saveContent]);

  useEffect(() => desktop?.onNoteFormat(applyFormat), [applyFormat, desktop]);

  useEffect(() => {
    function rememberSelection() {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      formatRange.current = range.cloneRange();
      setHasSelection(!range.collapsed);
      if (range.collapsed) setShowColors(false);
    }
    document.addEventListener('selectionchange', rememberSelection);
    return () => document.removeEventListener('selectionchange', rememberSelection);
  }, []);

  useEffect(() => {
    if (!desktop || !data || !noteId) return;
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0].blockSize;
      desktop.resizeNoteWindow(noteId, Math.ceil(height) + NOTE_HEIGHT_PADDING);
    });
    observer.observe(panel, { box: 'border-box' });
    return () => observer.disconnect();
  }, [data !== null, desktop, noteId]);

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

  function openFormatMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    formatRange.current = range && event.currentTarget.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    desktop?.showNoteFormatMenu(noteId, event.clientX, event.clientY, formatRange.current?.collapsed === false);
  }

  function toggleCheck(target: EventTarget) {
    if (!(target instanceof HTMLElement) || target.dataset.noteCheck === undefined) return false;
    setNoteCheck(target, target.dataset.noteCheck !== '1');
    saveContent();
    return true;
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (!desktop || event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = event.pointerId;
    desktop.startNoteDrag(noteId, event.clientX, event.clientY);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    if (dragging.current === event.pointerId) desktop?.moveNoteDrag(noteId);
  }

  function stopDrag(event: PointerEvent<HTMLElement>) {
    if (dragging.current !== event.pointerId) return;
    if (event.type === 'pointerup') moveDrag(event);
    dragging.current = null;
    desktop?.endNoteDrag(noteId);
  }

  return (
    <div className="note-window-root">
      <aside ref={panelRef} className="notes-panel note-window-panel" style={style} aria-label="桌面便签">
        <header title="按住拖动便签" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
          <StickyNoteIcon size={15} />
          <strong>便签</strong>
          <button type="button" aria-label="新建便签" title="新建便签" onClick={() => desktop?.newNote()}><Plus size={15} /></button>
          <button type="button" aria-label="销毁便签" title="销毁便签" onClick={() => { if (window.confirm('永久销毁这张便签？')) desktop?.deleteNote(noteId); }}><Trash2 size={14} /></button>
          <button type="button" aria-label="关闭便签" title="关闭便签（内容保留）" onClick={() => desktop?.closeNote(noteId)}><X size={15} /></button>
        </header>
        <div className="note-window-body">
          <div className={`sticky-note ${note.completed ? 'is-completed' : ''}`} data-background={appearance.noteTextBackground}>
            {appearance.showNoteCheckbox && <input type="checkbox" aria-label="完成便签" checked={note.completed} onChange={(event) => update({ completed: event.target.checked })} />}
            <div
              ref={editorRef}
              className="note-rich-editor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="便签内容"
              aria-multiline="true"
              onContextMenu={openFormatMenu}
              onFocus={() => { editingRef.current = true; }}
              onBlur={() => { editingRef.current = false; }}
              onInput={saveContent}
              onClick={(event) => { if (toggleCheck(event.target)) event.preventDefault(); }}
              onKeyDown={(event) => {
                if ((event.key === ' ' || event.key === 'Enter') && toggleCheck(event.target)) event.preventDefault();
              }}
              onPaste={(event) => {
                event.preventDefault();
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
              }}
              onDrop={(event) => event.preventDefault()}
            />
          </div>
        </div>
        <footer className="note-format-bar" aria-label="便签文字格式" onMouseDown={(event) => event.preventDefault()}>
          <div className="note-format-actions">
            <button type="button" disabled={!hasSelection} aria-expanded={showColors} title="选择文字后更改字体颜色" onClick={() => setShowColors((open) => !open)}><Palette size={13} />字体颜色</button>
            <button type="button" disabled={!hasSelection} title="选择文字后切换删除线" onClick={() => { setShowColors(false); applyFormat({ type: 'strike' }); }}><Strikethrough size={13} />删除线</button>
          </div>
          {showColors && hasSelection && <div className="note-format-colors" aria-label="字体颜色选项">
            {[{ label: '默认颜色', value: '' }, ...NOTE_COLORS].map(({ label, value }) => (
              <button key={label} type="button" className="note-format-swatch" aria-label={label} title={label} style={{ backgroundColor: value || appearance.noteTextColor }} onClick={() => {
                setShowColors(false);
                applyFormat({ type: 'color', color: value });
              }} />
            ))}
          </div>}
        </footer>
      </aside>
    </div>
  );
}