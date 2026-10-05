import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { authorize } from "./index";
import {
  exportAgendaTransfer,
  reviewAgendaTransfer,
  applyAgendaTransfer,
} from "../../../../../_lib/services/event-agenda/transfer";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-agenda-transfer";
export const AgendaTransferExportGet = openApiRoute(contracts.agendaTransferExportRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await exportAgendaTransfer(db, event.id, event.slug, data.query));
});
export const AgendaTransferReviewPost = openApiRoute(contracts.agendaTransferReviewRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, true);
  return json(await reviewAgendaTransfer(db, event.id, event.slug, data.body));
});
export const AgendaTransferApplyPost = openApiRoute(contracts.agendaTransferApplyRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await applyAgendaTransfer(db, event.id, event.slug, data.body, actor.id));
});
import { transferIdentityChoices } from "../../../../../_lib/services/event-agenda/transfer-identities";
export const AgendaTransferIdentitiesGet = openApiRoute(
  contracts.agendaTransferIdentitiesRouteSchema,
  async (c, data) => {
    const { db } = await authorize(c, data.params.eventSlug, true);
    return json(await transferIdentityChoices(db, data.query));
  },
);
