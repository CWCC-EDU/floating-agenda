import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { RecurrenceFields } from './components/RecurrenceFields';
import { addMonths, getCalendarDays, monthLabel, startOfMonth, toDateKey } from './lib/date';
import { DEFAULT_RECURRENCE, normalizeRecurrence, REPEAT_OPTIONS } from './lib/recurrence';
import { clockTime, isTaskTimeRange, timeInMinutes } from './lib/taskTime';
import type { RepeatRule } from './types';

const WHEEL_ROW_HEIGHT = 32;
const pad = (number: number) => String(number).padStart(2, '0');

function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(date));
  return (
    <div className="quick-date">
      <button type="button" aria-label="选择日期" aria-expanded={open} className="utility-field-button" onClick={() => {
        if (!open) setMonth(startOfMonth(date));
        setOpen(!open);
      }}><CalendarDays size={16} /><span>{date === toDateKey() ? `今天 · ${date}` : date}</span><ChevronDown size={14} /></button>
      {open && <div className="quick-date-picker" role="group" aria-label="选择日程日期">
        <header>
          <button type="button" aria-label="上一月" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
          <strong>{monthLabel(month)}</strong>
          <button type="button" aria-label="下一月" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
        </header>
        <div className="quick-date-grid">
          {['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}
          {getCalendarDays(month).map(day => <button type="button" key={day} aria-label={day} aria-pressed={day === date}
            className={startOfMonth(day) === month ? '' : 'is-muted'} onClick={() => { onChange(day); setOpen(false); }}>
            {Number(day.slice(-2))}
          </button>)}
        </div>
      </div>}
    </div>
  );
}

function TimeColumn({ label, size, value, onChange }: { label: string; size: number; value: number; onChange: (value: number) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; scroll: number; moved: boolean } | null>(null);
  const initial = useRef(value);
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = initial.current * WHEEL_ROW_HEIGHT; }, []);

  function pick(index: number) {
    const selected = Math.min(size - 1, Math.max(0, index));
    if (list.current) list.current.scrollTop = selected * WHEEL_ROW_HEIGHT;
    onChange(selected);
  }

  function dragTime(event: PointerEvent<HTMLDivElement>) {
    const previous = drag.current;
    if (!previous || previous.id !== event.pointerId) return;
    const delta = previous.y - event.clientY;
    if (!previous.moved && Math.abs(delta) < 4) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add('is-dragging');
    previous.moved = true;
    event.currentTarget.scrollTop = previous.scroll + delta;
  }

  return <div className="time-column" ref={list} role="listbox" aria-label={label} tabIndex={0}
    onScroll={(event) => onChange(Math.min(size - 1, Math.max(0, Math.round(event.currentTarget.scrollTop / WHEEL_ROW_HEIGHT))))}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      pick(value + (event.key === 'ArrowDown' ? 1 : -1));
    }}
    onPointerDown={(event) => {
      if (event.pointerType === 'mouse' && event.button === 0)
        drag.current = { id: event.pointerId, y: event.clientY, scroll: event.currentTarget.scrollTop, moved: false };
    }}
    onPointerMove={dragTime}
    onPointerUp={(event) => {
      event.currentTarget.classList.remove('is-dragging');
      if (drag.current?.moved) pick(Math.round(event.currentTarget.scrollTop / WHEEL_ROW_HEIGHT));
      drag.current = null;
    }}
    onPointerCancel={(event) => { event.currentTarget.classList.remove('is-dragging'); drag.current = null; }}
  >
    {Array.from({ length: size }, (_, index) => <div role="option" key={index} aria-selected={index === value} onClick={() => pick(index)}>{pad(index)}</div>)}
  </div>;
}

export default function QuickCaptureWindow() {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => toDateKey());
  const [{ start: time, end: endTime, customEnd }, setRange] = useState({ start: '', end: '', customEnd: false });
  const [timePicker, setTimePicker] = useState<'start' | 'end' | null>(null);
  const [repeat, setRepeat] = useState<RepeatRule>('none');
  const [pattern, setPattern] = useState(DEFAULT_RECURRENCE);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const id = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const composing = useRef(false);
  const recurrence = repeat === 'custom' ? normalizeRecurrence(pattern) : undefined;
  const valid = Boolean(title.trim()) && (repeat !== 'custom' || Boolean(recurrence))
    && (recurrence?.end.type !== 'until' || recurrence.end.date >= date) && isTaskTimeRange(time, endTime);
  const [hour, minute] = ((timePicker === 'end' ? endTime : time) || '00:00').split(':').map(Number);

  function changeWheel(part: 'hour' | 'minute', value: number) {
    setRange(current => {
      const original = timePicker === 'end' ? current.end : current.start;
      if (!original) return current;
      const next = part === 'hour' ? `${pad(value)}:${original.slice(3)}` : `${original.slice(0, 2)}:${pad(value)}`;
      if (next === original) return current;
      if (timePicker === 'end') return { ...current, end: next, customEnd: true };
      return { start: next, end: current.customEnd ? current.end : clockTime(timeInMinutes(next) + 60), customEnd: current.customEnd };
    });
  }

  function toggleStartPicker() {
    if (!time) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      setRange({ start: clockTime(minutes), end: clockTime(minutes + 60), customEnd: false });
    }
    setTimePicker(timePicker === 'start' ? null : 'start');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.desktop || !valid || inFlight.current || composing.current) return;
    inFlight.current = true;
    setSaving(true);
    setFeedback('');
    try {
      await window.desktop.submitQuickTask(id.current, { title: title.trim(), date, time, endTime: endTime || undefined, repeat, recurrence });
    } catch {
      setFeedback('保存失败，请重试。');
      setSaving(false);
      inFlight.current = false;
    }
  }

  return <main className="utility-window quick-window">
    <h1>快速记一条</h1>
    <form onSubmit={(event) => void submit(event)} onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && !composing.current) void window.desktop?.closeQuickCapture();
    }}>
      <label className="quick-field"><span>任务</span><input autoFocus maxLength={1000} value={title} required
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onChange={(event) => setTitle(event.target.value)} placeholder="输入要做的事" /></label>
      <div className="quick-field"><span>日期</span><DatePicker date={date} onChange={setDate} /></div>
      <div className="quick-field">
        <span>时间段 <small>可留空</small></span>
        <div className="quick-time-controls">
          <button type="button" className="utility-field-button" aria-expanded={timePicker === 'start'} onClick={toggleStartPicker}>
            <Clock3 size={16} /><span>{time ? `开始 ${time}` : '添加时间段'}</span><ChevronDown size={14} />
          </button>
          {time && <button type="button" className="utility-field-button" aria-expanded={timePicker === 'end'} onClick={() => {
            setTimePicker(timePicker === 'end' ? null : 'end');
          }}><span>结束 {endTime && endTime < time ? '次日 ' : ''}{endTime}</span><ChevronDown size={14} /></button>}
          {time && <button type="button" className="utility-button" onClick={() => { setRange({ start: '', end: '', customEnd: false }); setTimePicker(null); }}>清除</button>}
        </div>
        {timePicker && time && <div className="time-wheel" key={timePicker}>
          <TimeColumn label="小时" size={24} value={hour} onChange={value => changeWheel('hour', value)} />
          <span>:</span>
          <TimeColumn label="分钟" size={60} value={minute} onChange={value => changeWheel('minute', value)} />
        </div>}
        {!isTaskTimeRange(time, endTime) && <small role="status">开始和结束时间不能相同</small>}
      </div>
      <label className="quick-field"><span>重复</span><select value={repeat} onChange={(event) => setRepeat(event.target.value as RepeatRule)}>
        {REPEAT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {repeat === 'custom' && <RecurrenceFields date={date} value={pattern} onChange={setPattern} />}
      <footer><span role="status">{feedback || '回车添加'}</span><button type="submit" className="utility-button is-primary" disabled={!valid || saving}>{saving ? '正在添加…' : '添加日程'}</button></footer>
    </form>
  </main>;
}
