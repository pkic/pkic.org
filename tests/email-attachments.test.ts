import { describe, expect, it } from "vitest";
import { buildBadgeAttachment, parseQueuedEmailAttachments } from "../functions/_lib/email/attachments";

describe("queued email attachments", () => {
  it("retains supported badge descriptors and ignores retired uploaded ICS descriptors", () => {
    const badge = buildBadgeAttachment({
      badgeCode: "event_ref_123",
      badgeType: "attendee",
      firstName: "Ada",
      lastName: "Lovelace",
    });

    expect(
      parseQueuedEmailAttachments({
        __attachments: [
          badge,
          {
            kind: "r2-ics-file",
            r2Key: "retired/meeting.ics",
            filename: "meeting.ics",
          },
        ],
      }),
    ).toEqual([badge]);
  });
});
