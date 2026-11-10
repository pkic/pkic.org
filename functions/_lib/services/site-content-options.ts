import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import type { ContentCall } from "./site-shortcodes";

export interface SiteContentOptions {
  parameters?: Record<string, string>;
  query?: string;
  agendaRoute?: { agendaBasePath: string; initialDay?: string };
  publication?: SitePublicationSnapshot;
  /** Markdown for `{{< model >}}` from the pinned model version this page is published from. */
  modelContent?: (call: ContentCall) => string;
}
