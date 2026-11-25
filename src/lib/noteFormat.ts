import type { NotePatch, StickyNote } from '../types';

export function applyNotePatch(note: StickyNote, patch: NotePatch): StickyNote {
  const { removedImageIds, ...changes } = patch;
  const images = removedImageIds?.length ? note.images?.filter(image => !removedImageIds.includes(image.id)) : note.images;
  return { ...note, ...changes, images };
}

export function noteImageElement(id: string): HTMLImageElement {
  const image = document.createElement('img');
  image.dataset.noteImage = id;
  image.className = 'note-inline-image';
  image.alt = '便签图片';
  image.draggable = false;
  image.contentEditable = 'false';
  return image;
}

export const NOTE_COLORS = [
  { label: '红色', value: '#ff7676' },
  { label: '橙色', value: '#ffb873' },
  { label: '黄色', value: '#f7d96b' },
  { label: '绿色', value: '#80d5a1' },
  { label: '蓝色', value: '#8bc8ff' },
  { label: '紫色', value: '#c4a5fa' },
] as const;

const SIMPLE_TAGS = new Set(['DIV', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'UL', 'LI']);
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
    if (tag === 'IMG') {
      if (node.dataset.noteImage) parent.append(noteImageElement(node.dataset.noteImage));
      return;
    }
    const color = safeColor(node.style.color || (tag === 'FONT' ? node.getAttribute('color') ?? '' : ''));
    const decoration = node.style.textDecorationLine.split(' ').filter(value => value === 'line-through' || value === 'underline').join(' ');
    const bold = node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600;
    const italic = node.style.fontStyle === 'italic';
    let destination = parent;
    if (SIMPLE_TAGS.has(tag) || color || decoration || bold || italic) {
      destination = document.createElement(SIMPLE_TAGS.has(tag) ? tag : 'span');
      if (color) destination.style.color = color;
      if (decoration) destination.style.textDecorationLine = decoration;
      if (bold) destination.style.fontWeight = 'bold';
      if (italic) destination.style.fontStyle = 'italic';
      parent.append(destination);
    }
    node.childNodes.forEach((child) => copy(child, destination));
  }
  source.content.childNodes.forEach((node) => copy(node, target));
  return target.innerHTML;
}
