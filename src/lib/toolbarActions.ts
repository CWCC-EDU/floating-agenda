export const TOOLBAR_ACTIONS = [
  { id: 'today', label: '回到今天' }, { id: 'date', label: '选择日期' },
  { id: 'theme', label: '主题皮肤' }, { id: 'quick', label: '快速记一条' },
  { id: 'draw', label: '小画板' }, { id: 'new-note', label: '新建便签' },
  { id: 'notes', label: '管理便签' }, { id: 'adjust', label: '调整位置和大小' },
  { id: 'hide', label: '隐藏日历清单' }, { id: 'sync', label: '立即同步' },
  { id: 'settings', label: '日历设置' }, { id: 'quit', label: '退出软件' },
] as const;

export type ToolbarAction = typeof TOOLBAR_ACTIONS[number]['id'];
