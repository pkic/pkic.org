import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";

export interface SiteContentOptions {
  parameters?: Record<string, string>;
  query?: string;
  agendaRoute?: { agendaBasePath: string; initialDay?: string };
  publication?: SitePublicationSnapshot;
}
