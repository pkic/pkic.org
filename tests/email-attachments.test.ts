import { PERSONAL_PROMOTION_RENDERER } from "../assets/shared/personal-promotion-image";
import { describe, expect, it } from "vitest";
import {
  buildBadgeAttachment,
  parseQueuedEmailAttachments,
  queuedBadgeRendererIsCurrent,
} from "../functions/_lib/email/attachments";

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

it("accepts the current sponsor-free badge for mail queued before a design release", () => {
  const attachment = {
    ...buildBadgeAttachment({ badgeCode: "example", badgeType: "attendee" }),
    renderer: "promotion-scene-v5",
  };
  expect(queuedBadgeRendererIsCurrent(attachment, PERSONAL_PROMOTION_RENDERER)).toBe(true);
  expect(queuedBadgeRendererIsCurrent(attachment, "promotion-scene-v5")).toBe(false);
  expect(
    queuedBadgeRendererIsCurrent({ ...attachment, renderer: "promotion-scene-v999" }, PERSONAL_PROMOTION_RENDERER),
  ).toBe(false);
});
