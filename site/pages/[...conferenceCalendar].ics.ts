import { publication } from "../publication";
import type { APIContext } from "astro";
import { siteConferencePrograms } from "../../functions/_lib/services/site-content";
import { conferenceAgendaCalendar } from "../../functions/_lib/services/site-conference-calendar";

export function getStaticPaths() {
  return siteConferencePrograms(publication)
    .filter((event) => event.outputs.includes("event-agenda"))
    .map((event) => ({
      params: { conferenceCalendar: `${event.route}agenda`.replace(/^\//, "") },
      props: { calendar: conferenceAgendaCalendar(event.program, `https://pkic.org${event.route}`, event.updatedAt) },
    }));
}

export function GET({ props }: APIContext<{ calendar: string }>) {
  return new Response(props.calendar, { headers: { "content-type": "text/calendar; charset=utf-8" } });
}
