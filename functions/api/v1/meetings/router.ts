import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { MeetingJoinConfirm, MeetingJoinLanding } from "./occurrences/[occurrenceId]/join";
import { MeetingInvitationVerificationCreate } from "./occurrences/[occurrenceId]/invitations/verifications";
import { MeetingInvitationVerificationUpdate } from "./occurrences/[occurrenceId]/invitations/verifications/[verificationId]";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/occurrences/:occurrenceId/invitations/verifications", MeetingInvitationVerificationCreate);
openapi.patch(
  "/occurrences/:occurrenceId/invitations/verifications/:verificationId",
  MeetingInvitationVerificationUpdate,
);
openapi.get("/occurrences/:occurrenceId/join", MeetingJoinLanding);
openapi.post("/occurrences/:occurrenceId/join", MeetingJoinConfirm);

export default openapi;
