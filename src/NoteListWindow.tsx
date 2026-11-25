import { Plus, Search, StickyNote } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NotePreview } from './types';

export default function NoteListWindow() {
  const desktop = window.desktop;
  const [notes, setNotes] = useState<NotePreview[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const load = () => { void desktop.getNotePreviews().then(items => { if (active) setNotes(items); }); };
    const unsubscribe = desktop.onNotePreviews(setNotes);
    window.addEventListener('focus', load);
    load();
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', load); };
  }, [desktop]);
  const shown = [...notes].reverse().filter(note => note.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <main className="utility-window note-list-window window-entrance">
    <header><h1><StickyNote size={21} />便签</h1><button className="utility-button" type="button" onClick={() => desktop?.newNote()}><Plus size={17} />新建</button></header>
    <label className="note-list-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索便签" aria-label="搜索便签" /></label>
    <div className="note-list-cards">
      {!shown.length && <p>{query.trim() ? '没有匹配的便签' : '还没有便签'}</p>}
      {shown.map(note => <button key={note.id} type="button" className="note-list-card"
        onClick={event => { if (event.detail === 0) desktop?.openNoteFromList(note.id); }}
        onDoubleClick={() => desktop?.openNoteFromList(note.id)}>
        <span className="note-list-card-meta"><span>{note.open ? '已打开' : '已收起'}</span><time>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</time></span>
        {note.image && <img src={note.image} alt="便签图片预览" loading="lazy" />}
        <span className="note-list-card-text">{note.text.trim() || (note.image ? '图片便签' : '空白便签')}</span>
      </button>)}
    </div>
  </main>;
}
