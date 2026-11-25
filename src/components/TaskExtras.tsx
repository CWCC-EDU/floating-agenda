import type { MouseEvent } from 'react';
import type { Settings, Task, TaskExtrasMode, TaskSubtask } from '../types';

export function sortTaskSubtasks(task: Task, completedToBottom: boolean) {
  const subtasks = task.subtasks ?? [];
  return completedToBottom ? [...subtasks].sort((a, b) => Number(a.completed) - Number(b.completed)) : subtasks;
}

export function taskExtrasEntries(task: Task, mode: TaskExtrasMode, bulletStyle: Settings['bulletStyle'], subtasks: TaskSubtask[]) {
  const entries: { text: string; note?: boolean; subtask?: TaskSubtask; prefix?: string }[] = [];
  if ((mode === 'notes' || mode === 'all') && task.notes.trim()) entries.push({ text: task.notes, note: true });
  if (mode === 'subtasks' || mode === 'all') subtasks.forEach((item, index) => {
    if (item.title.trim()) entries.push({ text: item.title, subtask: item,
      prefix: bulletStyle === 'number' ? (index + 1) + '.' : bulletStyle === 'dot' ? '•' : undefined });
  });
  return entries;
}

export function TaskExtras({ task, mode, bulletStyle, subtasks, onSubtaskContext }: {
  task: Task;
  mode: TaskExtrasMode;
  bulletStyle: Settings['bulletStyle'];
  subtasks: TaskSubtask[];
  onSubtaskContext?: (subtask: TaskSubtask, event: MouseEvent<HTMLElement>) => void;
}) {
  const entries = taskExtrasEntries(task, mode, bulletStyle, subtasks);
  if (!entries.length) return null;
  return <span className="task-extras">
    {entries.map(({ text, note, subtask, prefix }) => <span key={subtask?.id ?? 'note'}
      className={'task-extra' + (note ? ' task-extra-note' : '') + (subtask?.completed ? ' is-completed' : '')}
      data-list-subtask={subtask?.id} onContextMenu={subtask && onSubtaskContext ? event => onSubtaskContext(subtask, event) : undefined}>
      {prefix && <span className="task-extra-prefix">{prefix}</span>}
      <span className="task-title-text">{text}</span>
    </span>)}
  </span>;
}
