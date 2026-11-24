import { Minus, Palette, Plus, Strikethrough, StickyNote as StickyNoteIcon, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import type { NoteFormat, NotePatch, NoteStatePayload } from './types';
import { NOTE_COLORS, cleanNoteHtml, noteCheckHtml, restoreNoteCaret, selectNoteLine, setNoteCheck } from './lib/noteFormat';

const NOTE_HEIGHT_PADDING = 8;
type NoteContent = Pick<NotePatch, 'text' | 'richText'>;

export default function NoteWindow() {
  const noteId = new URLSearchParams(window.location.search).get('id') ?? '';
  const [data, setData] = useState<NoteStatePayload | null>(null);
  const dragFrame = useRef<number | null>(null);
  const dragging = useRef<number | null>(null);
  const editingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [hasCaret, setHasCaret] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const caret = useRef<{ node: Node; offset: number } | null>(null);
  const formatRange = useRef<Range | null>(null);
  const shownContent = useRef<NoteContent | null>(null);
  const pendingContent = useRef<NoteContent | null>(null);
  const noteText = data?.note.text;
  const richText = data?.note.richText;
  const defaultColor = data?.appearance.noteTextColor;
  const desktop = window.desktop;

  useEffect(() => {
    if (!desktop || !noteId) return;
    let active = true;
    const receive = (payload: NoteStatePayload | null) => {
      if (!active || !payload || payload.note.id !== noteId) return;
      const pending = pendingContent.current;
      if (pending && pending.text === payload.note.text && pending.richText === payload.note.richText) {
        pendingContent.current = null;
      }
      const local = pending ?? (editingRef.current ? shownContent.current : null);
      setData(local ? { ...payload, note: { ...payload.note, ...local } } : payload);
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
    if (shownContent.current?.text === patch.text && shownContent.current.richText === patch.richText) return;
    shownContent.current = patch;
    pendingContent.current = patch;
    editor.dataset.empty = String(!text.trim());
    update(patch);
  }, [update]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || noteText === undefined) return;
    if (shownContent.current?.text === noteText && shownContent.current.richText === richText) return;
    if (pendingContent.current || (editingRef.current && shownContent.current)) return;
    if (richText === undefined) editor.textContent = noteText;
    else editor.innerHTML = cleanNoteHtml(richText);
    editor.dataset.empty = String(!noteText.trim());
    shownContent.current = { text: noteText, richText };
  }, [noteText, richText]);

  const applyFormat = useCallback((format: NoteFormat) => {
    const editor = editorRef.current;
    const range = formatRange.current;
    if (!editor || (format.type === 'color' && (!range || range.collapsed))) return;

    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (format.type === 'strike') {
      const position = caret.current;
      if (!position || !selection || !selectNoteLine(editor, selection, position.node, position.offset)) return;
      const before = document.createRange();
      before.setStart(editor, 0);
      const limit = position.node.nodeType === Node.TEXT_NODE ? position.node.textContent?.length ?? 0 : position.node.childNodes.length;
      before.setEnd(position.node, Math.min(position.offset, limit));
      const textOffset = before.toString().length;
      const mixed = document.queryCommandIndeterm('strikeThrough');
      document.execCommand('strikeThrough');
      restoreNoteCaret(editor, selection, textOffset, position.offset === 0);
      if (mixed && selection.focusNode && selectNoteLine(editor, selection, selection.focusNode, selection.focusOffset)) {
        if (!document.queryCommandState('strikeThrough')) document.execCommand('strikeThrough');
        restoreNoteCaret(editor, selection, textOffset, position.offset === 0);
      }
      if (selection.focusNode) caret.current = { node: selection.focusNode, offset: selection.focusOffset };
      saveContent();
      return;
    }
    if (range && selection && editor.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (format.type === 'checkbox') {
      selection?.collapseToEnd();
      document.execCommand('insertHTML', false, noteCheckHtml(false) + '&nbsp;');
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
      if (!editor || !selection?.rangeCount || !selection.focusNode) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      formatRange.current = range.cloneRange();
      caret.current = { node: selection.focusNode, offset: selection.focusOffset };
      setHasCaret(true);
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
    if (dragging.current !== event.pointerId || dragFrame.current !== null) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      if (dragging.current !== null) desktop?.moveNoteDrag(noteId);
    });
  }

  function stopDrag(event: PointerEvent<HTMLElement>) {
    if (dragging.current !== event.pointerId) return;
    if (dragFrame.current !== null) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    if (event.type === 'pointerup') desktop?.moveNoteDrag(noteId);
    dragging.current = null;
    desktop?.endNoteDrag(noteId);
  }

  return (
    <div className="note-window-root">
      <aside ref={panelRef} className="notes-panel note-window-panel" style={style} aria-label="桌面便签">
        <header title="按住拖动便签" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
          <StickyNoteIcon size={15} />
          <strong>便签</strong>
          <button type="button" aria-label="新增便签" title="新增便签" onClick={() => desktop?.newNote()}><Plus size={15} /></button>
          <button type="button" aria-label="最小化便签" title="最小化便签（保留内容）" onClick={() => desktop?.closeNote(noteId)}><Minus size={15} /></button>
          <button type="button" aria-label="销毁便签" title="销毁便签" onClick={() => { if (window.confirm('永久销毁这张便签？')) desktop?.deleteNote(noteId); }}><X size={15} /></button>
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
            <button type="button" disabled={!hasCaret} title="切换光标所在行的删除线" onClick={() => { setShowColors(false); applyFormat({ type: 'strike' }); }}><Strikethrough size={13} />删除线</button>
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
