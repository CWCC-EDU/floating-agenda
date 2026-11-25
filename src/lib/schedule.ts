import { timeAxisSegment } from './taskTime';
import type { Task } from '../types';

const MIN_BLOCK_MINUTES = 24;

export function layoutScheduleEvents(tasks: Task[], previousTasks: Task[]) {
  const events = [...tasks, ...previousTasks].flatMap((task, index) => {
    const continuing = index >= tasks.length;
    const segment = timeAxisSegment(task.time, task.endTime, continuing);
    if (!segment) return [];
    const start = Math.min(segment.from, 1440 - MIN_BLOCK_MINUTES);
    const end = Math.max(segment.to, start + MIN_BLOCK_MINUTES);
    return [{ task, ...segment, continuing, start, end, lane: 0, lanes: 1 }];
  }).sort((a, b) => a.start - b.start || b.end - a.end);

  let clusterStart = 0;
  let clusterEnd = 0;
  let laneEnds: number[] = [];
  function finishCluster(end: number) {
    for (let i = clusterStart; i < end; i += 1) events[i].lanes = laneEnds.length;
  }
  events.forEach((event, index) => {
    if (event.start >= clusterEnd) {
      finishCluster(index);
      clusterStart = index;
      clusterEnd = 0;
      laneEnds = [];
    }
    let lane = laneEnds.findIndex(end => end <= event.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = event.end;
    event.lane = lane;
    clusterEnd = Math.max(clusterEnd, event.end);
  });
  finishCluster(events.length);
  return events;
}
