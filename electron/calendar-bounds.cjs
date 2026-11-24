const MIN_CALENDAR_WIDTH = 760;
const MIN_CALENDAR_HEIGHT = 520;
const DEFAULT_CALENDAR_WIDTH = 1180;
const DEFAULT_CALENDAR_HEIGHT = 760;

function calendarIsReachable(bounds, area) {
  // Keep spanning placements only if the controls and a usable portion of the calendar remain visible.
  const reachWidth = Math.min(area.width, bounds.width, Math.max(120, Math.ceil(bounds.width / 2)));
  const reachHeight = Math.min(area.height, bounds.height, Math.max(120, Math.ceil(bounds.height / 2)));
  const right = bounds.x + bounds.width;
  return right - reachWidth >= area.x && right <= area.x + area.width
    && bounds.y >= area.y && bounds.y + reachHeight <= area.y + area.height;
}

function placeCalendar(bounds, area, center = false) {
  if (bounds && !center && calendarIsReachable(bounds, area)) return bounds;
  const overlaps = bounds && !center
    && bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
    && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  const width = Math.min(area.width, Math.max(MIN_CALENDAR_WIDTH, bounds?.width ?? Math.min(DEFAULT_CALENDAR_WIDTH, area.width - 64)));
  const height = Math.min(area.height, Math.max(MIN_CALENDAR_HEIGHT, bounds?.height ?? Math.min(DEFAULT_CALENDAR_HEIGHT, area.height - 64)));
  const x = overlaps
    ? Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
    : area.x + Math.floor((area.width - width) / 2);
  const y = overlaps
    ? Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
    : area.y + Math.floor((area.height - height) / 2);
  return { x, y, width, height };
}

module.exports = { MIN_CALENDAR_WIDTH, MIN_CALENDAR_HEIGHT, calendarIsReachable, placeCalendar };
