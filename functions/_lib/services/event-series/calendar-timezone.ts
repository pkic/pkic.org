import ICAL from "ical.js";
import { zonedDateTimeParts, zonedUtcOffsetSeconds } from "../../../../assets/shared/timezone";

/** Embed the platform's IANA transitions so calendar clients resolve the same wall clock. */
export function buildCalendarTimezone(timezone: string, startsAt: string, through: string): ICAL.Component {
  const component = new ICAL.Component("vtimezone");
  component.addPropertyWithValue("tzid", timezone);
  const start = Date.UTC(new Date(startsAt).getUTCFullYear(), 0, 1);
  const end = Date.UTC(new Date(through).getUTCFullYear() + 1, 0, 1);
  const offset = (at: number) => zonedUtcOffsetSeconds(new Date(at), timezone);
  const transitions: Array<{ at: number; from: number; to: number }> = [];
  function observance(at: number, from: number, to: number, initial = false) {
    const item = new ICAL.Component(!initial && to > from ? "daylight" : "standard");
    const local = ICAL.Time.fromData({
      ...zonedDateTimeParts(new Date(at - (initial ? 0 : 1000)), timezone),
      isDate: false,
    });
    if (!initial) local.adjust(0, 0, 0, 1);
    item.addPropertyWithValue("dtstart", local);
    item.addPropertyWithValue("tzoffsetfrom", ICAL.UtcOffset.fromSeconds(from));
    item.addPropertyWithValue("tzoffsetto", ICAL.UtcOffset.fromSeconds(to));
    return { item, local };
  }
  let previous = offset(start);
  const initialOffset = previous;
  for (let sample = start + 86400_000; sample <= end; sample += 86400_000) {
    const next = offset(sample);
    if (next === previous) continue;
    let low = sample - 86400_000;
    let high = sample;
    while (high - low > 1000) {
      const middle = Math.floor((low + high) / 2000) * 1000;
      if (offset(middle) === previous) low = middle;
      else high = middle;
    }
    transitions.push({ at: high, from: previous, to: next });
    previous = next;
  }
  if (!transitions.length) {
    component.addSubcomponent(observance(start, initialOffset, initialOffset, true).item);
    return component;
  }
  const groups: Array<{ item: ICAL.Component; local: ICAL.Time; key: string; lastYear: number; until: number }> = [];
  for (const transition of transitions) {
    const { item, local } = observance(transition.at, transition.from, transition.to);
    const ordinal = local.day + 7 > ICAL.Time.daysInMonth(local.month, local.year) ? -1 : Math.ceil(local.day / 7);
    const byDay = `${ordinal}${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][local.dayOfWeek() - 1]}`;
    const key = [
      item.name,
      transition.from,
      transition.to,
      local.month,
      byDay,
      local.hour,
      local.minute,
      local.second,
    ].join(":");
    const previousGroup = groups.find((group) => group.key === key && group.lastYear === local.year - 1);
    const until = ICAL.Time.fromJSDate(new Date(transition.at), true);
    if (previousGroup) {
      (previousGroup.item.getFirstPropertyValue("rrule") as ICAL.Recur).until = until;
      previousGroup.item.updatePropertyWithValue("rrule", previousGroup.item.getFirstPropertyValue("rrule"));
      previousGroup.lastYear = local.year;
      previousGroup.until = transition.at;
    } else {
      const rule = ICAL.Recur.fromString(`FREQ=YEARLY;BYMONTH=${local.month};BYDAY=${byDay}`);
      rule.until = until;
      item.addPropertyWithValue("rrule", rule);
      groups.push({ item, local, key, lastYear: local.year, until: transition.at });
    }
  }
  // Clients that approximate historical definitions see the latest observances first.
  for (const group of groups.sort((left, right) => right.until - left.until)) component.addSubcomponent(group.item);
  return component;
}
