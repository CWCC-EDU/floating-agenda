import { MAX_REPEAT_COUNT, MAX_REPEAT_INTERVAL } from '../lib/recurrence';
import type { RecurrencePattern, RepeatEnd, RepeatFrequency } from '../types';

const FREQUENCIES: { value: RepeatFrequency; label: string }[] = [
  { value: 'day', label: '天' }, { value: 'week', label: '周' },
  { value: 'month', label: '个月' }, { value: 'year', label: '年' },
];
const WEEKDAYS = [[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日']] as const;

export function RecurrenceFields({ date, value, onChange }: {
  date: string;
  value: RecurrencePattern;
  onChange: (pattern: RecurrencePattern) => void;
}) {
  function changeEnd(type: RepeatEnd['type']) {
    if (type === 'count') onChange({ ...value, end: { type, count: 3 } });
    else if (type === 'until') onChange({ ...value, end: { type, date } });
    else onChange({ ...value, end: { type } });
  }

  return (
    <div className="recurrence-fields">
      <div className="recurrence-row">
        <span>每隔</span>
        <input type="number" aria-label="重复间隔" min={1} max={MAX_REPEAT_INTERVAL} value={value.interval || ''}
          onChange={(event) => onChange({ ...value, interval: Number(event.target.value) })} />
        <select aria-label="重复单位" value={value.frequency}
          onChange={(event) => onChange({ ...value, frequency: event.target.value as RepeatFrequency })}>
          {FREQUENCIES.map(({ value: id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {value.frequency === 'week' && <div>
        <div className="recurrence-weekdays" role="group" aria-label="重复星期">
          {WEEKDAYS.map(([day, label]) => {
            const checked = value.weekdays?.includes(day) ?? false;
            return <button key={day} type="button" aria-label={`星期${label}`} aria-pressed={checked} onClick={() => {
              const weekdays = new Set(value.weekdays);
              if (checked) weekdays.delete(day);
              else weekdays.add(day);
              onChange({ ...value, weekdays: [...weekdays] });
            }}>{label}</button>;
          })}
        </div>
        <small>可多选，留空则沿用开始日的星期</small>
      </div>}
      <div className="recurrence-row">
        <span>结束</span>
        <select aria-label="结束方式" value={value.end.type} onChange={(event) => changeEnd(event.target.value as RepeatEnd['type'])}>
          <option value="never">不结束</option>
          <option value="count">指定次数</option>
          <option value="until">截止日期</option>
        </select>
        {value.end.type === 'count' && <input type="number" aria-label="总次数" min={1} max={MAX_REPEAT_COUNT} value={value.end.count || ''}
          onChange={(event) => onChange({ ...value, end: { type: 'count', count: Number(event.target.value) } })} />}
        {value.end.type === 'until' && <input type="date" aria-label="截止日期" min={date} value={value.end.date}
          onChange={(event) => onChange({ ...value, end: { type: 'until', date: event.target.value } })} />}
      </div>
      {value.end.type === 'count' && <small>总次数包含第一条日程</small>}
    </div>
  );
}
