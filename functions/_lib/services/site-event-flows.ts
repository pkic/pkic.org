import { EVENT_FLOW_SHELL_PATHS } from "../../../assets/shared/event-flow-paths";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import type { SiteContentPage } from "../../../assets/shared/site-content";

/** Reuse the authored workflow template for explicitly published public events. */
export async function loadPublishedEventFlow(
  route: string,
  publication: SitePublicationSnapshot | undefined,
  loadTemplate: (path: string) => Promise<SiteContentPage | null>,
): Promise<SiteContentPage | null> {
  const page = publication?.eventFlows?.find((page) => page.route === route);
  if (!page) return null;
  const template = await loadTemplate(EVENT_FLOW_SHELL_PATHS[page.flow]);
  if (!template) return null;
  const title = `${template.title} — ${page.eventName}`;
  return { ...template, route, title, hero: { ...template.hero, title } };
}
