import { Plus, StickyNote as StickyNoteIcon, Trash2, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Settings, StickyNote } from '../types';

interface NotesPanelProps {
  notes: StickyNote[];
  settings: Settings;
  onChange: (notes: StickyNote[]) => void;
  onClose: () => void;
}

export function NotesPanel({ notes, settings, onChange, onClose }: NotesPanelProps) {
  const alpha = Math.round(settings.noteOpacity / 100 * 255).toString(16).padStart(2, '0');
  const style = {
    '--note-background': `${settings.backgroundColor}${alpha}`,
    '--note-color': settings.noteTextColor,
    '--note-font-family': settings.noteFontFamily,
    '--note-font-size': `${settings.noteFontSize}px`,
    '--note-row-gap': `${settings.noteRowGap}px`,
  } as CSSProperties;

  function updateNote(id: string, patch: Partial<StickyNote>) {
    onChange(notes.map((note) => note.id === id ? { ...note, ...patch } : note));
  }

  return (
    <aside className="notes-panel" style={style} aria-label="桌面便签">
      <header><StickyNoteIcon size={15} /><strong>桌面便签</strong><button type="button" aria-label="新增便签" onClick={() => onChange([...notes, { id: crypto.randomUUID(), text: '', completed: false, createdAt: new Date().toISOString() }])}><Plus size={15} /></button><button type="button" aria-label="关闭便签" onClick={onClose}><X size={15} /></button></header>
      <div className="notes-list">
        {notes.map((note, index) => (
          <div className={`sticky-note ${note.completed ? 'is-completed' : ''}`} data-background={settings.noteTextBackground} key={note.id}>
            <span className="note-bullet">{settings.noteBulletStyle === 'number' ? `${index + 1}.` : settings.noteBulletStyle === 'dot' ? '•' : ''}</span>
            {settings.showNoteCheckbox && <input type="checkbox" aria-label={`完成便签 ${index + 1}`} checked={note.completed} onChange={(event) => updateNote(note.id, { completed: event.target.checked })} />}
            <textarea aria-label={`便签 ${index + 1}`} value={note.text} placeholder="写点什么…" rows={3} onChange={(event) => updateNote(note.id, { text: event.target.value })} />
            <button className="note-delete" type="button" aria-label={`删除便签 ${index + 1}`} onClick={() => {
              if (window.confirm('删除这条便签？')) onChange(notes.filter((item) => item.id !== note.id));
            }}><Trash2 size={13} /></button>
          </div>
        ))}
        {notes.length === 0 && <div className="notes-empty"><StickyNoteIcon size={23} /><p>还没有便签</p><button type="button" onClick={() => onChange([{ id: crypto.randomUUID(), text: '', completed: false, createdAt: new Date().toISOString() }])}>新建第一条</button></div>}
      </div>
    </aside>
  );
}
