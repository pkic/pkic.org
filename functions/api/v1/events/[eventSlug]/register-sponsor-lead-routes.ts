import { EventSponsorLeadCreate } from "./attendance";
import { SponsorLeadsExportGet } from "./lead-export";
import {
  SponsorLeadSponsorsGet,
  SponsorLeadsGet,
  SponsorLeadDetailGet,
  SponsorLeadOwnCapturesDelete,
  SponsorLeadDelete,
  SponsorLeadCapturesGet,
  SponsorLeadConfirmationGet,
} from "./lead-list";

type SponsorLeadRouter = Pick<typeof import("./router").openapi, "get" | "post" | "delete">;

/** Sponsor lead capture, review and export, behind the event router's management middleware. */
export function registerSponsorLeadRoutes(openapi: SponsorLeadRouter): void {
  openapi.get("/sponsors/:sponsorId/leads.csv", SponsorLeadsExportGet);
  openapi.get("/sponsors/leads", SponsorLeadSponsorsGet);
  openapi.get("/sponsors/:sponsorId/leads", SponsorLeadsGet);
  openapi.get("/sponsors/:sponsorId/leads/:leadId", SponsorLeadDetailGet);
  openapi.delete("/sponsors/:sponsorId/leads/:leadId/captures", SponsorLeadOwnCapturesDelete);
  openapi.delete("/sponsors/:sponsorId/leads/:leadId", SponsorLeadDelete);
  openapi.get("/sponsors/:sponsorId/leads/confirmations/:operationId", SponsorLeadConfirmationGet);
  openapi.get("/sponsors/:sponsorId/leads/:leadId/captures", SponsorLeadCapturesGet);
  openapi.post("/sponsors/:sponsorId/leads", EventSponsorLeadCreate);
}
