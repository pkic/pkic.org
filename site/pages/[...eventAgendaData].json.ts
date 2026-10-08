import { publicationRouteCacheKey } from "../publication-cache";
import type { APIContext } from "astro";
import { publication } from "../publication";
import {
  publishedEventAgendas,
  approvedEventProgram,
} from "../../functions/_lib/services/site-published-event-agendas";
import type { ConferenceProgram } from "../../assets/shared/schemas/conference-program";
export function getStaticPaths() {
  return publishedEventAgendas(publication).map(({ snapshot, route }) => {
    const program = approvedEventProgram(snapshot);
    return {
      params: { eventAgendaData: `${route}data`.replace(/^\//, "") },
      props: { program },
      cacheKey: publicationRouteCacheKey(`${route}data.json`, program),
    };
  });
}
export function GET({ props }: APIContext<{ program: ConferenceProgram }>) {
  return new Response(JSON.stringify(props.program), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
