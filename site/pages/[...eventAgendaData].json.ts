import type { APIContext } from "astro";
import { publication } from "../publication";
import {
  publishedEventAgendas,
  approvedEventProgram,
} from "../../functions/_lib/services/site-published-event-agendas";
import type { ConferenceProgram } from "../../assets/shared/schemas/conference-program";
export function getStaticPaths() {
  return publishedEventAgendas(publication).map(({ snapshot, route }) => ({
    params: { eventAgendaData: `${route}data`.replace(/^\//, "") },
    props: { program: approvedEventProgram(snapshot) },
  }));
}
export function GET({ props }: APIContext<{ program: ConferenceProgram }>) {
  return new Response(JSON.stringify(props.program), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
