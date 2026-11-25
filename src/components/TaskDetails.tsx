import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Task, TaskSubtask } from '../types';

export function TaskDetails({ task, onChange, onClose }: {
  task: Task;
  onChange(patch: Partial<Task>): void;
  onClose(): void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const subtasks = task.subtasks ?? [];

  function changeSubtask(id: string, patch: Partial<TaskSubtask>) {
    onChange({ subtasks: subtasks.map(item => item.id === id ? { ...item, ...patch } : item) });
  }

  return <section className="task-detail-pane" aria-label="任务子任务与备注">
    <header>
      <h3 title={task.title}>{task.title}</h3>
      <button type="button" className="icon-button" aria-label="返回日程列表" onClick={onClose}><X size={17} /></button>
    </header>
    <fieldset>
      <legend>子任务</legend>
      {subtasks.map(item => <div key={item.id} className="task-subtask">
        <input type="checkbox" checked={item.completed} aria-label={'完成子任务：' + item.title}
          onChange={event => changeSubtask(item.id, { completed: event.target.checked })} />
        <input type="text" aria-label="子任务名称" value={item.title}
          onChange={event => changeSubtask(item.id, { title: event.target.value })} />
        <button type="button" aria-label={'删除子任务：' + item.title}
          onClick={() => onChange({ subtasks: subtasks.filter(entry => entry.id !== item.id) })}><X size={13} /></button>
      </div>)}
      <form className="task-subtask" onSubmit={event => {
        event.preventDefault();
        const title = newTitle.trim();
        if (!title) return;
        onChange({ subtasks: [...subtasks, { id: crypto.randomUUID(), title, completed: false }] });
        setNewTitle('');
      }}>
        <input aria-label="新子任务" placeholder="添加子任务" value={newTitle} onChange={event => setNewTitle(event.target.value)} />
        <button type="submit" aria-label="添加子任务" disabled={!newTitle.trim()}><Plus size={15} /></button>
      </form>
    </fieldset>
    <label>备注<textarea aria-label="任务备注" rows={4} value={task.notes} placeholder="记录这个任务的补充信息"
      onChange={event => onChange({ notes: event.target.value })} /></label>
    <footer><button type="button" onClick={onClose}>完成编辑</button></footer>
  </section>;
}
