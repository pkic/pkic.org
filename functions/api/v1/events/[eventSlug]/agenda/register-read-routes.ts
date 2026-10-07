import { AgendaPreviewGet } from "./previews";
import { AgendaRoomsGet } from "./rooms";
import { AgendaBlocksGet } from "./blocks";
import { AgendaPublicationRequestsGet } from "./publication-requests";
import { AgendaOccurrenceFilterOptionsGet } from "./occurrence-filter-options";
import {
  AgendaGet,
  AgendaPeopleGet,
  AgendaOccurrencesGet,
  AgendaHistoryIdentitiesGet,
  AgendaHistoryMaterialsGet,
} from "./index";

type AgendaReadRouter = Pick<typeof import("../router").openapi, "get">;

/** Keep agenda browsing and exact public previews on the existing event router and middleware. */
export function registerAgendaReadRoutes(openapi: AgendaReadRouter): void {
  openapi.get("/agenda", AgendaGet);
  openapi.get("/agenda/rooms", AgendaRoomsGet);
  openapi.get("/agenda/blocks", AgendaBlocksGet);
  openapi.get("/agenda/publication-requests", AgendaPublicationRequestsGet);
  openapi.get("/agenda/previews", AgendaPreviewGet);
  openapi.get("/agenda/people", AgendaPeopleGet);
  openapi.get("/agenda/occurrences", AgendaOccurrencesGet);
  openapi.get("/agenda/occurrences/filters", AgendaOccurrenceFilterOptionsGet);
  openapi.get("/agenda/occurrences/:occurrenceId/history/identities", AgendaHistoryIdentitiesGet);
  openapi.get("/agenda/occurrences/:occurrenceId/history/materials", AgendaHistoryMaterialsGet);
}
