export const NOTE_COLORS = [
  { label: '红色', value: '#ff7676' },
  { label: '橙色', value: '#ffb873' },
  { label: '黄色', value: '#f7d96b' },
  { label: '绿色', value: '#80d5a1' },
  { label: '蓝色', value: '#8bc8ff' },
  { label: '紫色', value: '#c4a5fa' },
] as const;

const SIMPLE_TAGS = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'TEMPLATE']);

function safeColor(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  if (!rgb) return '';
  const channels = rgb.slice(1).map(Number);
  return channels.every((channel) => channel <= 255)
    ? '#' + channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')
    : '';
}

export function setNoteCheck(element: HTMLElement, checked: boolean) {
  element.dataset.noteCheck = checked ? '1' : '0';
  element.contentEditable = 'false';
  element.setAttribute('role', 'checkbox');
  element.setAttribute('aria-checked', String(checked));
  element.tabIndex = 0;
  element.textContent = checked ? '☑' : '☐';
}

export function noteCheckHtml(checked: boolean): string {
  const check = document.createElement('span');
  setNoteCheck(check, checked);
  return check.outerHTML;
}

export function selectNoteLine(editor: HTMLElement, selection: Selection, node: Node, offset: number): boolean {
  if (!editor.contains(node)) return false;
  const limit = node.nodeType === Node.TEXT_NODE ? node.textContent?.length ?? 0 : node.childNodes.length;
  selection.collapse(node, Math.min(offset, limit));
  selection.modify('move', 'backward', 'paragraphboundary');
  selection.modify('extend', 'forward', 'paragraphboundary');
  return !selection.isCollapsed && selection.rangeCount > 0
    && editor.contains(selection.getRangeAt(0).commonAncestorContainer);
}

export function restoreNoteCaret(editor: HTMLElement, selection: Selection, textOffset: number, preferStart: boolean) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.length) continue;
    if (textOffset < node.length || (textOffset === node.length && !preferStart)) {
      selection.collapse(node, textOffset);
      return;
    }
    textOffset -= node.length;
  }
  selection.collapse(editor, editor.childNodes.length);
}

export function cleanNoteHtml(html: string): string {
  const source = document.createElement('template');
  source.innerHTML = html;
  const target = document.createElement('div');
  function copy(node: Node, parent: HTMLElement) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (!(node instanceof HTMLElement) || DROP_TAGS.has(node.tagName)) return;
    if (node.tagName === 'SPAN' && (node.dataset.noteCheck === '0' || node.dataset.noteCheck === '1')) {
      const check = document.createElement('span');
      setNoteCheck(check, node.dataset.noteCheck === '1');
      parent.append(check);
      return;
    }

    const tag = node.tagName;
    const color = safeColor(node.style.color || (tag === 'FONT' ? node.getAttribute('color') ?? '' : ''));
    const strike = node.style.textDecorationLine.split(' ').includes('line-through');
    let destination = parent;
    if (SIMPLE_TAGS.has(tag) || color || strike) {
      destination = document.createElement(SIMPLE_TAGS.has(tag) ? tag : 'span');
      if (color) destination.style.color = color;
      if (strike) destination.style.textDecorationLine = 'line-through';
      parent.append(destination);
    }
    node.childNodes.forEach((child) => copy(child, destination));
  }
  source.content.childNodes.forEach((node) => copy(node, target));
  return target.innerHTML;
}
