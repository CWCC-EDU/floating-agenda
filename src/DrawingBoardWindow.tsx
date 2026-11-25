import { Download, Eraser, Image, PenLine, Redo2, RotateCcw, StickyNote, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Brush = 'pen' | 'marker' | 'eraser';
type Point = { x: number; y: number };
type Stroke = { brush: Brush; width: number; color: string; points: Point[] };
type Viewport = Point & { zoom: number };
const MAX_IMAGE_SIZE = 2400;
const HOME_VIEW: Viewport = { x: 0, y: 0, zoom: 1 };

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const first = stroke.points[0];
  context.save();
  context.globalCompositeOperation = stroke.brush === 'eraser' ? 'destination-out' : 'source-over';
  context.globalAlpha = stroke.brush === 'marker' ? 0.38 : 1;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (stroke.points.length === 1) {
    context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const point = stroke.points[i];
      context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  context.restore();
}

function drawBoard(canvas: HTMLCanvasElement, width: number, height: number, scale: number, strokes: Stroke[], view: Viewport, active?: Stroke) {
  const bitmapWidth = Math.max(1, Math.round(width * scale));
  const bitmapHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, bitmapWidth / scale, bitmapHeight / scale);
  context.translate(view.x, view.y);
  context.scale(view.zoom, view.zoom);
  for (const stroke of strokes) drawStroke(context, stroke);
  if (active) drawStroke(context, active);
}

async function encodeBoard(strokes: Stroke[], area: DOMRect) {
  let left = 0, top = 0, right = area.width, bottom = area.height;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      left = Math.min(left, point.x - stroke.width / 2);
      top = Math.min(top, point.y - stroke.width / 2);
      right = Math.max(right, point.x + stroke.width / 2);
      bottom = Math.max(bottom, point.y + stroke.width / 2);
    }
  }
  const canvas = document.createElement('canvas');
  const width = right - left, height = bottom - top;
  const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(width, height));
  drawBoard(canvas, width, height, scale, strokes, { x: -left, y: -top, zoom: 1 });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法导出画板');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('无法生成图片');
  return new Uint8Array(await blob.arrayBuffer());
}

export default function DrawingBoardWindow() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const noteDialog = useRef<HTMLDialogElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const undone = useRef<Stroke[]>([]);
  const drawing = useRef<{ id: number; stroke: Stroke } | null>(null);
  const viewport = useRef<Viewport>(HOME_VIEW);
  const pan = useRef<{ id: number; pointer: Point; origin: Point } | null>(null);
  const frame = useRef<number | null>(null);
  const noteRequest = useRef<{ id: string; target?: string } | null>(null);
  const [noteTargets, setNoteTargets] = useState<{ id: string; label: string }[]>([]);
  const [targetNote, setTargetNote] = useState('');
  const saving = useRef(false);
  const [brush, setBrush] = useState<Brush>('pen');
  const [width, setWidth] = useState(4);
  const [color, setColor] = useState('#263e47');
  const [strokeCount, setStrokeCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [panning, setPanning] = useState(false);

  function schedulePaint() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const surface = canvas.current;
      if (!surface) return;
      const { width: w, height: h } = surface.getBoundingClientRect();
      if (!w || !h) return;
      const scale = Math.min(window.devicePixelRatio || 1, MAX_IMAGE_SIZE / Math.max(w, h));
      drawBoard(surface, w, h, scale, strokes.current, viewport.current, drawing.current?.stroke);
    });
  }

  function stepHistory(redo: boolean) {
    if (drawing.current || pan.current) return;
    const source = redo ? undone.current : strokes.current;
    const target = redo ? strokes.current : undone.current;
    const stroke = source.pop();
    if (!stroke) return;
    target.push(stroke);
    setStrokeCount(strokes.current.length);
    setRedoCount(undone.current.length);
    schedulePaint();
  }

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const zoomAtPointer = (event: WheelEvent) => {
      if (!document.hasFocus() || clearDialog.current?.open || noteDialog.current?.open || drawing.current || pan.current) return;
      event.preventDefault();
      const current = viewport.current;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1);
      const zoom = Math.min(4, Math.max(0.25, current.zoom * Math.exp(-delta * 0.002)));
      if (zoom === current.zoom) return;
      const rect = surface.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const ratio = zoom / current.zoom;
      viewport.current = { x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, zoom };
      setZoomPercent(Math.round(zoom * 100));
      schedulePaint();
    };
    function historyShortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || clearDialog.current?.open || noteDialog.current?.open) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      stepHistory(key === 'y');
    }
    window.addEventListener('keydown', historyShortcut);
    const observer = new ResizeObserver(schedulePaint);
    observer.observe(surface);
    surface.addEventListener('wheel', zoomAtPointer, { passive: false });
    window.addEventListener('resize', schedulePaint);
    schedulePaint();
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', historyShortcut);
      surface.removeEventListener('wheel', zoomAtPointer);
      window.removeEventListener('resize', schedulePaint);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  function position(event: { clientX: number; clientY: number }, area: DOMRect): Point {
    const view = viewport.current;
    return {
      x: (Math.min(area.width, Math.max(0, event.clientX - area.left)) - view.x) / view.zoom,
      y: (Math.min(area.height, Math.max(0, event.clientY - area.top)) - view.y) / view.zoom,
    };
  }

  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary || drawing.current || pan.current || (event.button !== 0 && event.button !== 2)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      event.preventDefault();
      pan.current = { id: event.pointerId, pointer: { x: event.clientX, y: event.clientY }, origin: viewport.current };
      setPanning(true);
      return;
    }
    drawing.current = { id: event.pointerId, stroke: { brush, width, color, points: [position(event, event.currentTarget.getBoundingClientRect())] } };
    schedulePaint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const drag = pan.current;
    if (drag?.id === event.pointerId) {
      viewport.current = { zoom: viewport.current.zoom, x: drag.origin.x + event.clientX - drag.pointer.x,
        y: drag.origin.y + event.clientY - drag.pointer.y };
      schedulePaint();
      return;
    }
    const active = drawing.current;
    if (!active || active.id !== event.pointerId) return;
    const area = event.currentTarget.getBoundingClientRect();
    const events = event.nativeEvent.getCoalescedEvents?.();
    for (const sample of events?.length ? events : [event]) {
      const point = position(sample, area);
      const previous = active.stroke.points.at(-1)!;
      if (point.x !== previous.x || point.y !== previous.y) active.stroke.points.push(point);
    }
    schedulePaint();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (pan.current?.id === event.pointerId) {
      if (event.type === 'pointerup') move(event);
      pan.current = null;
      setPanning(false);
      return;
    }
    const active = drawing.current;
    if (!active || active.id !== event.pointerId) return;
    if (event.type === 'pointerup') move(event);
    strokes.current.push(active.stroke);
    undone.current = [];
    setRedoCount(0);
    drawing.current = null;
    setStrokeCount(strokes.current.length);
    schedulePaint();
  }

  function clearBoard() {
    strokes.current = [];
    undone.current = [];
    setRedoCount(0);
    drawing.current = null;
    pan.current = null;
    setPanning(false);
    setStrokeCount(0);
    setFeedback('');
    clearDialog.current?.close();
    schedulePaint();
  }

  async function chooseNote() {
    if (!window.desktop) return;
    try {
      setFeedback('');
      setNoteTargets(await window.desktop.listDrawingNotes());
      setTargetNote('');
      noteDialog.current?.showModal();
    } catch {
      setFeedback('无法读取便签列表，请重试。');
    }
  }

  async function save(mode: 'export' | 'note', target?: string) {
    const desktop = window.desktop;
    if (!desktop || !canvas.current || strokes.current.length === 0 || saving.current) return;
    saving.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const png = await encodeBoard(strokes.current, canvas.current.getBoundingClientRect());
      if (mode === 'export') {
        if (await desktop.exportDrawing(png)) setFeedback('图片已保存');
      } else {
        if (!noteRequest.current || noteRequest.current.target !== target) noteRequest.current = { id: crypto.randomUUID(), target };
        await desktop.saveDrawingNote(noteRequest.current.id, png, target);
        noteRequest.current = null;
        noteDialog.current?.close();
        setFeedback(target ? '已插入所选便签' : '已新建图片便签');
      }
    } catch {
      setFeedback('保存失败，请重试。');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <main className="utility-window drawing-window">
    <h1><Image size={20} />小画板</h1>
    <div className="drawing-tools">
      <label><PenLine size={16} />画笔<select value={brush} onChange={(event) => setBrush(event.target.value as Brush)}>
        <option value="pen">钢笔</option><option value="marker">马克笔</option><option value="eraser">橡皮擦</option>
      </select></label>
      <label>粗细<input type="range" min={1} max={40} value={width} onChange={(event) => setWidth(Number(event.target.value))} /><output>{width} px</output></label>
      <label>颜色<input type="color" value={color} disabled={brush === 'eraser'} onChange={(event) => setColor(event.target.value)} /></label>
      <button type="button" className="utility-button drawing-icon" aria-label="撤销一笔" title="撤销一笔 (Ctrl+Z)" disabled={!strokeCount}
        onClick={() => stepHistory(false)}><Undo2 size={17} /></button>
      <button type="button" className="utility-button drawing-icon" aria-label="重做一笔" title="重做一笔 (Ctrl+Y)" disabled={!redoCount}
        onClick={() => stepHistory(true)}><Redo2 size={17} /></button>
      <button type="button" className="utility-button drawing-icon" aria-label="清空画板" title="清空画板" disabled={!strokeCount}
        onClick={() => clearDialog.current?.showModal()}><Trash2 size={16} /></button>
      <button type="button" className="utility-button drawing-icon" aria-label="重置画布视图" title="重置画布位置和缩放" onClick={() => {
        viewport.current = HOME_VIEW;
        setZoomPercent(100);
        schedulePaint();
      }}><RotateCcw size={15} /><span>{zoomPercent}%</span></button>
    </div>
    <div className="drawing-surface">
      <canvas className={panning ? 'is-panning' : undefined} aria-label={brush === 'eraser' ? '画板橡皮擦' : '绘图区域'} ref={canvas} tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()} onPointerDown={down} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
      {brush === 'eraser' && <span className="drawing-mode" aria-hidden="true"><Eraser size={14} />橡皮擦</span>}
    </div>
    <footer>
      <span role="status">{feedback || '关闭后清空画板'}</span>
      <button type="button" className="utility-button" disabled={!strokeCount || busy} onClick={() => void save('export')}><Download size={15} />保存图片</button>
      <button type="button" className="utility-button is-primary" disabled={!strokeCount || busy} onClick={() => void chooseNote()}><StickyNote size={15} />插入便签</button>
    </footer>
    <dialog ref={noteDialog} className="drawing-clear-dialog drawing-note-dialog" aria-labelledby="drawing-note-title"
      onClose={() => canvas.current?.focus({ preventScroll: true })}>
      <h2 id="drawing-note-title">插入到便签</h2>
      <label>目标便签<select value={targetNote} aria-label="目标便签" onChange={event => setTargetNote(event.target.value)}>
        <option value="">新建便签</option>
        {noteTargets.map(note => <option key={note.id} value={note.id}>{note.label}</option>)}
      </select></label>
      {feedback && <p role="status">{feedback}</p>}
      <form method="dialog">
        <button className="utility-button" disabled={busy}>取消</button>
        <button type="button" className="utility-button is-primary" disabled={busy} onClick={() => void save('note', targetNote || undefined)}>插入图片</button>
      </form>
    </dialog>
    <dialog ref={clearDialog} className="drawing-clear-dialog" aria-labelledby="drawing-clear-title"
      onClose={() => canvas.current?.focus({ preventScroll: true })}>
      <h2 id="drawing-clear-title">清空画板？</h2>
      <form method="dialog">
        <button className="utility-button" autoFocus>取消</button>
        <button type="button" className="utility-button is-primary" onClick={clearBoard}>确认清空</button>
      </form>
    </dialog>
  </main>;
}
