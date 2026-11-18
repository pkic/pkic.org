import {
  liveChatArchiveExportRouteSchema,
  liveChatEraseRouteSchema,
} from "../../../../../../assets/shared/schemas/event-live-chat-archive";
import { csvResponse } from "../../../../../_lib/csv";
import { markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { jsonNoStore } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { eraseEventChat, exportEventChat } from "../../../../../_lib/services/live-session/chat-archive";
import { requireEventPermission } from "../authorization";

/** An organizer downloads the attendee chat the event's rooms still hold. */
export const LiveChatArchiveExportGet = openApiRoute(
  liveChatArchiveExportRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    return csvResponse(await exportEventChat(db, c.env, actor, event.id), `${event.slug}-live-chat.csv`);
  },
);

/** An organizer erases the chat of every session whose room has closed. */
export const LiveChatEraseDelete = openApiRoute(liveChatEraseRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return jsonNoStore(await eraseEventChat(db, c.env, actor, event.id));
});
