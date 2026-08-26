import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { MeetingGuestInvitationBootstrap } from "./invitations/bootstrap";
import { MeetingGuestInvitationVerify } from "./invitations/verify";
import { GuestMeetingJoinConfirm, GuestMeetingJoinLanding } from "./meetings/occurrences/[occurrenceId]/join";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/invitations/bootstrap", MeetingGuestInvitationBootstrap);
openapi.post("/invitations/verify", MeetingGuestInvitationVerify);
openapi.get("/meetings/occurrences/:occurrenceId/join", GuestMeetingJoinLanding);
openapi.post("/meetings/occurrences/:occurrenceId/join", GuestMeetingJoinConfirm);

export default openapi;
