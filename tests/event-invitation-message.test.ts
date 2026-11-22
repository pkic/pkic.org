import { describe, expect, it } from "vitest";
import { eventInvitationWording } from "../assets/shared/event-invitation-copy";
import {
  EVENT_INVITATION_HEADLINE_MAX,
  EVENT_INVITATION_MESSAGE_MAX,
  eventInvitationMessageSchema,
  readEventInvitationMessage,
} from "../assets/shared/schemas/event-invitation-message";
import { eventSettingsUpdateSchema } from "../assets/shared/schemas/event-management";

describe("an event's invitation wording", () => {
  it("accepts a bounded headline and message, trimmed", () => {
    expect(eventInvitationMessageSchema.parse({ headline: "  Join us  ", message: "**Two days**" })).toEqual({
      headline: "Join us",
      message: "**Two days**",
    });
    expect(eventInvitationMessageSchema.parse({ headline: null, message: null })).toEqual({
      headline: null,
      message: null,
    });
  });

  it.each([
    ["a headline that is too long", { headline: "x".repeat(EVENT_INVITATION_HEADLINE_MAX + 1), message: null }],
    ["a headline that is too short", { headline: "Hi", message: null }],
    ["a message that is too long", { headline: null, message: "x".repeat(EVENT_INVITATION_MESSAGE_MAX + 1) }],
    ["an unknown key", { headline: null, message: null, html: "<b>" }],
  ])("refuses %s", (_, value) => {
    expect(eventInvitationMessageSchema.safeParse(value).success).toBe(false);
  });

  it("is part of the event settings update contract", () => {
    const parsed = eventSettingsUpdateSchema.parse({
      expectedUpdatedAt: "2026-11-01T00:00:00.000Z",
      invitationMessage: { headline: "Join us", message: null },
    });
    expect(parsed.invitationMessage).toEqual({ headline: "Join us", message: null });
  });

  it("reads stored wording, and nothing when it is empty or no longer valid", () => {
    expect(readEventInvitationMessage({ invitationMessage: { headline: "Join us", message: null } })).toEqual({
      headline: "Join us",
      message: null,
    });
    expect(readEventInvitationMessage({ invitationMessage: { headline: null, message: null } })).toBeNull();
    expect(readEventInvitationMessage({ invitationMessage: { headline: 42 } })).toBeNull();
    expect(readEventInvitationMessage({})).toBeNull();
    expect(readEventInvitationMessage(null)).toBeNull();
  });

  it("falls back to a neutral headline from the event's name", () => {
    expect(eventInvitationWording({ name: "PQC Conference" }, null)).toEqual({
      headline: "You're invited to PQC Conference",
      message: null,
    });
    expect(eventInvitationWording({ name: "PQC Conference" }, { headline: null, message: "Come" })).toEqual({
      headline: "You're invited to PQC Conference",
      message: "Come",
    });
  });
});
