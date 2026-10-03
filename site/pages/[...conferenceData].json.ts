import type { APIContext } from "astro";
import { siteConferencePrograms } from "../../functions/_lib/services/site-content";
import type { ConferenceProgram } from "../../assets/shared/schemas/conference-program";

export function getStaticPaths() {
  return siteConferencePrograms()
    .filter((event) => event.outputs.includes("event-data"))
    .map((event) => ({
      params: { conferenceData: `${event.route}event-data`.replace(/^\//, "") },
      props: { program: event.program },
    }));
}

export function GET({ props }: APIContext<{ program: ConferenceProgram }>) {
  return new Response(JSON.stringify(props.program), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
