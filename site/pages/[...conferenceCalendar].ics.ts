import { publicConferenceAgendaCalendar } from "../../functions/_lib/services/site-agenda-calendar-pages";
import { publicationRouteCacheKey } from "../publication-cache";
import { publication } from "../publication";
import type { APIContext, GetStaticPathsResult } from "astro";
import { siteConferencePrograms } from "../../functions/_lib/services/site-content";

export function getStaticPaths(): GetStaticPathsResult {
  return siteConferencePrograms(publication)
    .filter((event) => event.outputs.includes("event-agenda"))
    .map((event) => {
      const calendar = publicConferenceAgendaCalendar(publication, event);
      return {
        params: { conferenceCalendar: `${event.route}agenda`.replace(/^\//, "") },
        props: { calendar },
        cacheKey: publicationRouteCacheKey(`${event.route}agenda.ics`, { calendar }),
      };
    });
}
export function GET({ props }: APIContext<{ calendar: string }>) {
  return new Response(props.calendar, { headers: { "content-type": "text/calendar; charset=utf-8" } });
}
