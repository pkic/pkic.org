import type { APIContext } from "astro";
import { publication } from "../publication";
import {
  publishedEventAgendas,
  approvedEventProgram,
} from "../../functions/_lib/services/site-published-event-agendas";
import { conferenceAgendaCalendar } from "../../functions/_lib/services/site-conference-calendar";
export function getStaticPaths() {
  return publishedEventAgendas(publication).map(({ snapshot, route }) => ({
    params: { eventAgendaCalendar: `${route}calendar`.replace(/^\//, "") },
    props: {
      calendar: conferenceAgendaCalendar(
        approvedEventProgram(snapshot),
        new URL(route, "https://pkic.org").href,
        snapshot.approvedAt ?? "1970-01-01T00:00:00.000Z",
      ),
    },
  }));
}
export function GET({ props }: APIContext<{ calendar: string }>) {
  return new Response(props.calendar, { headers: { "content-type": "text/calendar; charset=utf-8" } });
}
