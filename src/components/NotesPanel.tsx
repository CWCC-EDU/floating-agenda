import { Plus, StickyNote as StickyNoteIcon, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { NotesAppearance, StickyNote } from '../types';

const NOTE_PANEL_POSITION_KEY = 'floating-agenda-note-panel-position-v1';
const PANEL_MARGIN = 4;

interface PanelPosition {
  left: number;
  top: number;
}

function readPanelPosition(): PanelPosition | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NOTE_PANEL_POSITION_KEY) ?? 'null');
    if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
      return { left: Math.round(parsed.left), top: Math.round(parsed.top) };
    }
  } catch {
    // Ignore malformed or unavailable storage and fall back to the default corner.
  }
  return null;
}

function clampPanelPosition(left: number, top: number, panel: HTMLElement, shell: HTMLElement): PanelPosition {
  const maxLeft = Math.max(PANEL_MARGIN, shell.clientWidth - panel.offsetWidth - PANEL_MARGIN);
  const maxTop = Math.max(PANEL_MARGIN, shell.clientHeight - panel.offsetHeight - PANEL_MARGIN);
  return {
    left: Math.min(maxLeft, Math.max(PANEL_MARGIN, Math.round(left))),
    top: Math.min(maxTop, Math.max(PANEL_MARGIN, Math.round(top))),
  };
}

interface NotesPanelProps {
  notes: StickyNote[];
  settings: NotesAppearance;
  onChange: (notes: StickyNote[]) => void;
  onClose: () => void;
}

export function NotesPanel({ notes, settings, onChange, onClose }: NotesPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<PanelPosition | null>(readPanelPosition);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; grabX: number; grabY: number } | null>(null);
  const positionRef = useRef(position);

  const alpha = Math.round(settings.noteOpacity / 100 * 255).toString(16).padStart(2, '0');
  const style = {
    '--note-background': `${settings.backgroundColor}${alpha}`,
    '--note-color': settings.noteTextColor,
    '--note-font-family': settings.noteFontFamily,
    '--note-font-size': `${settings.noteFontSize}px`,
    '--note-row-gap': `${settings.noteRowGap}px`,
    ...(position ? { left: position.left, top: position.top, right: 'auto', maxHeight: `calc(100% - ${position.top}px - 8px)` } : {}),
  } as CSSProperties;

  function updateNote(id: string, patch: Partial<StickyNote>) {
    onChange(notes.map((note) => note.id === id ? { ...note, ...patch } : note));
  }

  function applyPosition(next: PanelPosition | null) {
    positionRef.current = next;
    setPosition(next);
  }

  useEffect(() => {
    const panel = panelRef.current;
    const shell = panel?.offsetParent as HTMLElement | null;
    if (!panel || !shell) return;
    const keepInside = () => {
      if (!positionRef.current) return;
      applyPosition(clampPanelPosition(positionRef.current.left, positionRef.current.top, panel, shell));
    };
    keepInside();
    window.addEventListener('resize', keepInside);
    return () => window.removeEventListener('resize', keepInside);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      const shell = panel?.offsetParent as HTMLElement | null;
      if (!drag || drag.pointerId !== event.pointerId || !panel || !shell) return;
      const shellRect = shell.getBoundingClientRect();
      applyPosition(clampPanelPosition(
        event.clientX - shellRect.left - drag.grabX,
        event.clientY - shellRect.top - drag.grabY,
        panel,
        shell,
      ));
    };
    const onPointerEnd = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      if (positionRef.current) {
        window.localStorage.setItem(NOTE_PANEL_POSITION_KEY, JSON.stringify(positionRef.current));
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [dragging]);

  function startNoteDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;
    const panel = panelRef.current;
    const shell = panel?.offsetParent as HTMLElement | null;
    if (!panel || !shell) return;
    const panelRect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      grabX: event.clientX - panelRect.left,
      grabY: event.clientY - panelRect.top,
    };
    event.preventDefault();
    setDragging(true);
  }

  return (
    <aside ref={panelRef} className={`notes-panel ${dragging ? 'is-dragging' : ''}`} style={style} aria-label="桌面便签">
      <header title="按住拖动便签" onPointerDown={startNoteDrag}><StickyNoteIcon size={15} /><strong>桌面便签</strong><button type="button" aria-label="新增便签" onClick={() => onChange([...notes, { id: crypto.randomUUID(), text: '', completed: false, createdAt: new Date().toISOString(), open: true }])}><Plus size={15} /></button><button type="button" aria-label="关闭便签" onClick={onClose}><X size={15} /></button></header>
      <div className="notes-list">
        {notes.map((note, index) => (
          <div className={`sticky-note ${note.completed ? 'is-completed' : ''}`} data-background={settings.noteTextBackground} key={note.id}>
            <span className="note-bullet">{settings.noteBulletStyle === 'number' ? `${index + 1}.` : settings.noteBulletStyle === 'dot' ? '•' : ''}</span>
            {settings.showNoteCheckbox && <input type="checkbox" aria-label={`完成便签 ${index + 1}`} checked={note.completed} onChange={(event) => updateNote(note.id, { completed: event.target.checked })} />}
            {note.image ? <img className="drawing-note-image" src={note.image} alt="画板便签" draggable={false} />
              : <textarea aria-label={`便签 ${index + 1}`} value={note.text} placeholder="写点什么…" rows={3} onChange={(event) => updateNote(note.id, { text: event.target.value, richText: undefined })} />}
            <button className="note-delete" type="button" aria-label={`删除便签 ${index + 1}`} onClick={() => {
              if (window.confirm('删除这条便签？')) onChange(notes.filter((item) => item.id !== note.id));
            }}><Trash2 size={13} /></button>
          </div>
        ))}
        {notes.length === 0 && <div className="notes-empty"><StickyNoteIcon size={23} /><p>还没有便签</p><button type="button" onClick={() => onChange([{ id: crypto.randomUUID(), text: '', completed: false, createdAt: new Date().toISOString(), open: true }])}>新建第一条</button></div>}
      </div>
    </aside>
  );
}
