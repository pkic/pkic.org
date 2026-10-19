import type { APIContext, GetStaticPathsResult } from "astro";
import { publicationRouteCacheKey } from "../publication-cache";
import { publication } from "../publication";
import {
  publicAgendaCalendarPages,
  publicSessionCalendarPages,
} from "../../functions/_lib/services/site-agenda-calendar-pages";
export function getStaticPaths(): GetStaticPathsResult {
  return [...publicAgendaCalendarPages(publication), ...publicSessionCalendarPages(publication)].map(
    ({ path, content }) => ({
      params: { eventAgendaCalendar: path.replace(/^\//, "").replace(/\.ics$/, "") },
      props: { calendar: content },
      cacheKey: publicationRouteCacheKey(path, { calendar: content }),
    }),
  );
}
export function GET({ props }: APIContext<{ calendar: string }>) {
  return new Response(props.calendar, { headers: { "content-type": "text/calendar; charset=utf-8" } });
}
