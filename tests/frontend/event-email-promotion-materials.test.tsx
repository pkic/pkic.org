// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventEmailCampaignPreviewInputSchema } from "../../assets/shared/schemas/event-email-campaigns";
import { EventEmailCampaign } from "../../assets/ts/components/events/EventEmailCampaign";
import { promotionMaterialFile } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/promotion-file-keys";
import { labelNames } from "./helpers/labeled-control";
import {
  CAMPAIGN_PATH,
  EVENT_PATH,
  PREVIEW_BODY,
  composeAndPreview,
  json,
  mount,
  settle,
  stubCampaignFetch,
  unmountComposers,
} from "./helpers/event-email-campaign";

afterEach(unmountComposers);

describe("event message with picked promotion files", () => {
  it("sends the picked promotion files to their one person through the shared composer", async () => {
    const requests = stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });
    const files = [
      promotionMaterialFile("session:occurrence-1:portrait"),
      promotionMaterialFile("attendee:carousel"),
      promotionMaterialFile("attendee:badge-square"),
    ].flatMap((file) => file ?? []);
    expect(files).toEqual([
      { kit: "session", occurrenceId: "occurrence-1", format: "portrait" },
      { kit: "attendee", format: "carousel" },
      { kit: "badge", format: "square" },
    ]);
    expect(promotionMaterialFile("attendee:poster")).toBeNull();
    const onReview = vi.fn();
    const container = mount(
      <EventEmailCampaign
        campaignsPath={CAMPAIGN_PATH}
        daysPath={`${EVENT_PATH}/days`}
        materials={{ userId: "person-1", files, onReview }}
      />,
    );
    await settle();
    expect(labelNames(container)).not.toContain("Audience");
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Review files")!.click();
    expect(onReview).toHaveBeenCalledOnce();
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Tall post, session kit",
      "Carousel, attendee kit",
      "Square badge",
    ]);
    await composeAndPreview(container);

    const preview = eventEmailCampaignPreviewInputSchema.parse(
      requests.find(({ path }) => path === `${CAMPAIGN_PATH}/previews`)?.body,
    );
    expect(preview).toMatchObject({
      sendMode: "personal",
      filter: { audience: "attendees", attendeeStatus: "all", userIds: ["person-1"] },
      materials: { files },
    });
    expect(container.textContent).toContain("attendee@example.test");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Send test to me")).toBe(
      false,
    );
    expect(
      eventEmailCampaignPreviewInputSchema.safeParse({
        ...preview,
        filter: { ...preview.filter, audience: "speakers" },
      }).success,
    ).toBe(false);

    const rerender = (picked: typeof files) =>
      act(() =>
        render(
          <EventEmailCampaign
            campaignsPath={CAMPAIGN_PATH}
            daysPath={`${EVENT_PATH}/days`}
            materials={{ userId: "person-1", files: picked, onReview }}
          />,
          container,
        ),
      );
    // A re-render with the same files keeps the reviewed preview; other files need a new one.
    await rerender([...files]);
    expect(container.textContent).toContain("attendee@example.test");
    await rerender(files.slice(1));
    expect(container.textContent).not.toContain("attendee@example.test");
    expect(container.textContent).toContain("Shown in the preview");
  });

  it("drops a preview that answers after the picked files changed", async () => {
    let answer: (response: Response) => void = () => {};
    stubCampaignFetch({ previews: () => new Promise<Response>((resolve) => (answer = resolve)) });
    const files = [promotionMaterialFile("attendee:carousel"), promotionMaterialFile("attendee:square")].flatMap(
      (file) => file ?? [],
    );
    const composer = (picked: typeof files) => (
      <EventEmailCampaign
        campaignsPath={CAMPAIGN_PATH}
        daysPath={`${EVENT_PATH}/days`}
        materials={{ userId: "person-1", files: picked, onReview: () => {} }}
      />
    );
    const container = mount(composer(files));
    await settle();
    await composeAndPreview(container);
    // The organizer attaches other files while the first preview is still on its way.
    await act(() => render(composer(files.slice(1)), container));
    answer(json(PREVIEW_BODY));
    await settle();
    expect(container.textContent).not.toContain("attendee@example.test");
    expect(container.textContent).not.toContain("Preview ready");
  });
});
