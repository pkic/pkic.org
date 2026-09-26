import {
  GroupEventAttendeeInvitesList,
  GroupEventAttendeeInviteResend,
  GroupEventAttendeeInviteRevoke,
  GroupEventSpeakerInvitesList,
  GroupEventSpeakerInviteResend,
  GroupEventSpeakerInviteRevoke,
} from "./[groupId]/events/[eventId]/invites";
import {
  GroupEventAttendeeInviteBulkPost,
  GroupEventAttendeeInvitePreviewPost,
  GroupEventSpeakerInviteBulkPost,
  GroupEventSpeakerInvitePreviewPost,
} from "./[groupId]/events/[eventId]/invites-bulk";

type GroupEventInviteRouter = {
  get(path: string, route: unknown): unknown;
  post(path: string, route: unknown): unknown;
};

export function registerGroupEventInviteRoutes(openapi: unknown): void {
  const router = openapi as GroupEventInviteRouter;
  router.get("/:groupId/events/:eventId/invites", GroupEventAttendeeInvitesList);
  router.post("/:groupId/events/:eventId/invites/attendees/preview", GroupEventAttendeeInvitePreviewPost);
  router.post("/:groupId/events/:eventId/invites/attendees/bulk", GroupEventAttendeeInviteBulkPost);
  router.get("/:groupId/events/:eventId/invites/speakers", GroupEventSpeakerInvitesList);
  router.post("/:groupId/events/:eventId/invites/speakers/preview", GroupEventSpeakerInvitePreviewPost);
  router.post("/:groupId/events/:eventId/invites/speakers/bulk", GroupEventSpeakerInviteBulkPost);
  router.post("/:groupId/events/:eventId/invites/:inviteId/resend", GroupEventAttendeeInviteResend);
  router.post("/:groupId/events/:eventId/invites/:inviteId/revoke", GroupEventAttendeeInviteRevoke);
  router.post("/:groupId/events/:eventId/invites/speakers/:inviteId/resend", GroupEventSpeakerInviteResend);
  router.post("/:groupId/events/:eventId/invites/speakers/:inviteId/revoke", GroupEventSpeakerInviteRevoke);
}
