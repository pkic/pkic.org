import { publicAgendaChildRoutes } from "../../../assets/shared/publication-agenda-routes";
import { agendaContent } from "../../../assets/shared/public-agenda-content";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { inheritedEventDocument } from "./site-component-data";
import type { ContentDocument } from "./site-documents";
import { approvedEventAgendaForRoute } from "./site-published-event-agendas";
import { publishedConferenceProgram } from "./site-conference-program";

/** Derive child pages only from the exact public document that renders the canonical agenda shortcode. */
export function authoredAgendaPageRoutes(
  documents: readonly ContentDocument[],
  rendersAgenda: (markdown: string) => boolean,
  publication?: SitePublicationSnapshot,
) {
  const routes = new Map<string, ReturnType<typeof publicAgendaChildRoutes>[number] & { sourceRoute: string }>();
  for (const document of documents) {
    if (
      document.language !== "en" ||
      document.data.draft === true ||
      document.data.redirect ||
      !document.route.startsWith("/events/") ||
      !rendersAgenda(document.body)
    )
      continue;
    const event = inheritedEventDocument(document, documents);
    if (!event || event.data.draft === true || !event.data.data?.agenda) continue;
    const approved = approvedEventAgendaForRoute(publication, document.route, event.route);
    const dates = approved
      ? agendaContent(approved).days.map((day) => day.date)
      : Object.keys(publishedConferenceProgram(event.data.data, () => []).agenda);
    const agendaBasePath = document.route.endsWith("/agenda/") ? document.route : `${document.route}agenda/`;
    for (const child of publicAgendaChildRoutes(agendaBasePath, dates)) {
      const previous = routes.get(child.route);
      if (previous && previous.sourceRoute !== document.route)
        throw new Error("Agenda child has multiple authored source owners");
      if (documents.some((candidate) => candidate.route === child.route))
        throw new Error("Agenda child collides with an authored page");
      routes.set(child.route, { ...child, sourceRoute: document.route });
    }
  }
  return [...routes.values()];
}
