// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { emailMessageTypeSchema } from "../../assets/shared/schemas/api-common";
import {
  eventEmailCampaignAudienceSchema,
  eventEmailCampaignCreateInputSchema,
  eventEmailCampaignDayWaitlistFilterSchema,
  eventEmailCampaignInvitationStatusFilterSchema,
  eventEmailCampaignPreviewInputSchema,
  eventEmailCampaignSendModeSchema,
  eventEmailCampaignSpeakerStatusFilterSchema,
} from "../../assets/shared/schemas/event-email-campaigns";
import { availableHelperLabelsForAudience } from "../../assets/ts/components/events/event-email-campaign-support";
import { PREVIEW_DEFAULTS, TEMPLATE_HELPERS } from "../../assets/ts/shared/email-template-helpers";
import { EventEmailCampaign } from "../../assets/ts/components/events/EventEmailCampaign";
import { controlFor, labelNames, optionValues, typeMarkdown } from "./helpers/labeled-control";
import {
  CAMPAIGN_PATH,
  EVENT_PATH,
  GROUP_ID,
  EVENT_ID,
  PREVIEW_BODY,
  clickButton,
  composeAndPreview,
  inputText,
  json,
  mount,
  settle,
  stubCampaignFetch,
  unmountComposers,
} from "./helpers/event-email-campaign";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

async function chooseAudience(container: HTMLElement, value: string): Promise<void> {
  const control = controlFor<HTMLSelectElement>(container, "Audience");
  await act(() => {
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The send gate: the one checkbox on the surface, or null before a preview exists. */
function confirmationBox(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

const DAY_ONE = {
  id: "day-one",
  date: "2026-12-01",
  label: "Day one",
  startsAt: null,
  endsAt: null,
  sortOrder: 0,
  attendanceOptions: [],
  attendanceCounts: {},
};

afterEach(unmountComposers);

describe("event email campaign UI", () => {
  it("prefills a planning message without sending or overwriting an authored draft", async () => {
    const requests = stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });
    const container = mount(
      <EventEmailCampaign
        campaignsPath={CAMPAIGN_PATH}
        daysPath={`${EVENT_PATH}/days`}
        initialSubject="Plan your sessions"
        initialBody="Save favorites to show interest, then register where required."
      />,
    );
    await settle();
    expect(controlFor<HTMLInputElement>(container, "Subject").value).toBe("Plan your sessions");
    await inputText(controlFor(container, "Subject"), "My authored message");
    await typeMarkdown(container, "Message", "My authored body");
    await act(async () => {
      render(
        <EventEmailCampaign
          campaignsPath={CAMPAIGN_PATH}
          daysPath={`${EVENT_PATH}/days`}
          initialSubject="Changed preset"
          initialBody="Changed preset body"
        />,
        container,
      );
    });
    await clickButton(container, "Preview Email");
    await settle();
    const preview = eventEmailCampaignPreviewInputSchema.parse(
      requests.find(({ path }) => path === `${CAMPAIGN_PATH}/previews`)?.body,
    );
    expect(preview.subjectOverride).toBe("My authored message");
    expect(preview.filter).toMatchObject({ audience: "attendees", attendeeStatus: "registered" });
    expect(requests.some(({ method, path }) => method === "POST" && path === CAMPAIGN_PATH)).toBe(false);
  });

  it("sends kits to the speakers of one day, personally, and offers a test once previewed", async () => {
    const requests = stubCampaignFetch({
      previews: () => json(PREVIEW_BODY),
      tests: () => json({ success: true, sessionTitle: "Planning a migration" }, 202),
      days: [DAY_ONE],
    });
    const container = mount(
      <EventEmailCampaign
        campaignsPath={CAMPAIGN_PATH}
        daysPath={`${EVENT_PATH}/days`}
        initialAudience="speakers"
        initialAttachKits
      />,
    );
    await settle();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Send test to me")).toBe(
      false,
    );
    const day = controlFor<HTMLSelectElement>(container, "Specific day");
    await act(() => {
      day.value = DAY_ONE.date;
      day.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await composeAndPreview(container);

    const preview = eventEmailCampaignPreviewInputSchema.parse(
      requests.find(({ path }) => path === `${CAMPAIGN_PATH}/previews`)?.body,
    );
    expect(preview.sendMode).toBe("personal");
    expect(preview.kit).toEqual({ formats: ["portrait", "carousel"], resend: false });
    expect(preview.filter).toMatchObject({ audience: "speakers", speakerStatus: "scheduled", dayDate: DAY_ONE.date });

    await clickButton(container, "Send test to me");
    await settle();
    const test = eventEmailCampaignCreateInputSchema.parse(
      requests.find(({ path }) => path === `${CAMPAIGN_PATH}/tests`)?.body,
    );
    expect(test.previewToken).toBe("campaign-preview-token");
    expect(requests.some(({ method, path }) => method === "POST" && path === CAMPAIGN_PATH)).toBe(false);
  });

  it("says why a kit send with no formats cannot be previewed", async () => {
    const requests = stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });
    const container = mount(
      <EventEmailCampaign
        campaignsPath={CAMPAIGN_PATH}
        daysPath={`${EVENT_PATH}/days`}
        initialAudience="speakers"
        initialAttachKits
      />,
    );
    await settle();
    for (const name of ["Tall post", "Carousel"]) {
      const box = [...container.querySelectorAll("label")]
        .find((label) => label.textContent?.startsWith(name))
        ?.querySelector("input");
      await act(async () => box?.click());
    }
    await composeAndPreview(container);
    expect(container.textContent).toContain("Choose at least one format.");
    expect(requests.some(({ path }) => path === `${CAMPAIGN_PATH}/previews`)).toBe(false);
  });

  it("previews and creates a campaign through one canonical nested resource", async () => {
    const requests = stubCampaignFetch({
      previews: () => json(PREVIEW_BODY),
      campaigns: () =>
        json({ success: true, queuedRecipients: 1, queuedBatches: 1, stagedRecipients: 1, mode: "personal" }, 202),
    });

    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await composeAndPreview(container);

    // Parsed through the shared request contract rather than compared field by
    // field: a payload the schema rejects is a broken request whatever a
    // literal comparison of one property says.
    const previewRequest = requests.find(({ path }) => path === `${CAMPAIGN_PATH}/previews`);
    const previewInput = eventEmailCampaignPreviewInputSchema.parse(previewRequest?.body);
    expect(previewInput.filter.audience).toBe("attendees");
    expect(previewInput.subjectOverride).toBe("Working group update");
    expect(previewInput.sendMode).toBe("personal");

    const confirmation = confirmationBox(container)!;
    await act(async () => confirmation.click());
    await clickButton(container, "Send Email");
    await settle();

    const sendRequest = requests.find(({ method, path }) => method === "POST" && path === CAMPAIGN_PATH);
    const sendInput = eventEmailCampaignCreateInputSchema.parse(sendRequest?.body);
    expect(sendInput.previewToken).toBe("campaign-preview-token");
    expect(sendInput.bodyContent).toBe("Hello {{firstName}}");
    expect(requests.every(({ path }) => !path.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("isolates the untrusted preview HTML and names the surface for assistive technology", async () => {
    stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });

    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await composeAndPreview(container);

    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("/email/preview/");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(frame.getAttribute("title")).toBe("Rendered campaign email preview");

    // The send outcome is announced rather than only shown.
    const live = container.querySelector('[role="status"]')!;
    expect(live.textContent).toContain("Preview ready");

    // The confirmation gate is the design system's checkbox: the label wraps
    // the control, so the whole line is the hit target.
    const confirmation = confirmationBox(container)!;
    expect(confirmation.classList.contains("pk-check__input")).toBe(true);
    const label = confirmation.closest("label")!;
    expect(label.classList.contains("pk-check")).toBe(true);
    expect(label.querySelector(".pk-check__label")?.textContent).toContain("confirm sending");
    const actions = label.parentElement!;
    expect([...actions.querySelectorAll("button")].some((button) => button.textContent === "Send Email")).toBe(true);
    expect(frame.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Every control the surface owns is named through its own label, and each
    // label resolves to its control — the lookup fails exactly when the
    // for/id pair is broken.
    const names = [
      "Audience",
      "Template",
      "Delivery mode",
      "Message type",
      "Subject",
      "Message",
      "Registration status",
      "Attendance type",
      "Specific day",
      "Day waitlist",
    ];
    expect(labelNames(container)).toEqual(expect.arrayContaining(names));
    for (const name of names) controlFor(container, name);
    expect(controlFor<HTMLTextAreaElement>(container, "Message").tagName).toBe("TEXTAREA");
    expect(controlFor(container, "Template").getAttribute("role")).toBe("combobox");
  });

  it("inserts a template variable at the source caret and invalidates the previous confirmation", async () => {
    stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });
    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await composeAndPreview(container);
    await act(async () => confirmationBox(container)!.click());
    const source = controlFor<HTMLTextAreaElement>(container, "Message");
    source.setSelectionRange(6, source.value.length);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Insert variables and conditions"]')!.click();
    });
    await clickButton(container, "firstName");
    expect(source.value).toBe("Hello {{firstName}}");
    await typeMarkdown(container, "Message", "Revised message for all attendees");
    expect(confirmationBox(container)).toBeNull();
    const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send Email")!;
    expect(send.disabled).toBe(true);
  });

  it("reports a failed preview and keeps the send gate closed", async () => {
    const notify = vi.fn();
    stubCampaignFetch({
      previews: () => json({ error: { code: "RECIPIENT_QUERY_FAILED", message: "Recipient query failed." } }, 500),
    });

    const container = mount(
      <EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} notify={notify} />,
    );
    await composeAndPreview(container);

    expect(container.querySelector('[role="status"]')!.textContent).toBe("Recipient query failed.");
    expect(notify).toHaveBeenCalledWith("Recipient query failed.", "error");
    // No preview means no confirmation checkbox, and the send button stays
    // disabled: a failed preview can never become a send.
    expect(confirmationBox(container)).toBeNull();
    const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send Email")!;
    expect(send.disabled).toBe(true);
  });

  it.each(["subjectOverride", "bodyContent"] as const)(
    "marks the %s field after an unknown-variable refusal",
    async (field) => {
      const requests = stubCampaignFetch({
        previews: () =>
          json(
            {
              error: {
                code: "CAMPAIGN_TEMPLATE_UNRESOLVED",
                message: "Fix the message before sending.",
                details: { fieldErrors: { [field]: ["Unknown variable: {{doesNotExist}}"] } },
              },
            },
            422,
          ),
      });
      const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
      await composeAndPreview(container);
      const control = controlFor(container, field === "subjectOverride" ? "Subject" : "Message");
      expect(control.getAttribute("aria-invalid")).toBe("true");
      expect(container.textContent).toContain("{{doesNotExist}}");
      expect(confirmationBox(container)).toBeNull();
      const preview = requests.find(({ path }) => path === `${CAMPAIGN_PATH}/previews`);
      eventEmailCampaignPreviewInputSchema.parse(preview?.body);
    },
  );

  it("reports a rejected send and leaves the composed message intact", async () => {
    const notify = vi.fn();
    stubCampaignFetch({
      previews: () => json(PREVIEW_BODY),
      campaigns: () => json({ error: { code: "PREVIEW_TOKEN_EXPIRED", message: "Preview token expired." } }, 422),
    });

    const container = mount(
      <EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} notify={notify} />,
    );
    await composeAndPreview(container);
    await act(async () => confirmationBox(container)!.click());
    await clickButton(container, "Send Email");
    await settle();

    expect(notify).toHaveBeenCalledWith("Preview token expired.", "error");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Preview token expired.");
    // The draft is not cleared on failure, so the operator can retry.
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Hello {{firstName}}");
    const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send Email")!;
    expect(send.getAttribute("aria-busy")).toBeNull();
    expect(send.disabled).toBe(false);
  });

  it("offers every value the campaign contract accepts, in each of its vocabularies", async () => {
    stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });

    // Compared against the schemas the route parses rather than against a list
    // written here: a value added to the contract has to reach the composer,
    // which is exactly what issue #24 found missing elsewhere.
    const attendees = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await settle();
    expect(optionValues(controlFor<HTMLSelectElement>(attendees, "Audience"))).toEqual(
      eventEmailCampaignAudienceSchema.options,
    );
    expect(
      controlFor(attendees, "Audience").compareDocumentPosition(controlFor(attendees, "Template")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(optionValues(controlFor<HTMLSelectElement>(attendees, "Delivery mode"))).toEqual(
      eventEmailCampaignSendModeSchema.options,
    );
    expect(optionValues(controlFor<HTMLSelectElement>(attendees, "Message type"))).toEqual(
      emailMessageTypeSchema.options,
    );
    expect(optionValues(controlFor<HTMLSelectElement>(attendees, "Day waitlist"))).toEqual(
      eventEmailCampaignDayWaitlistFilterSchema.options,
    );

    await chooseAudience(attendees, "speakers");
    expect(optionValues(controlFor<HTMLSelectElement>(attendees, "Speaker status"))).toEqual(
      eventEmailCampaignSpeakerStatusFilterSchema.options,
    );
    await chooseAudience(attendees, "attendee_invitations");
    expect(optionValues(controlFor<HTMLSelectElement>(attendees, "Invitation status"))).toEqual(
      eventEmailCampaignInvitationStatusFilterSchema.options,
    );
    expect(attendees.textContent).not.toContain("Speaker status");
  });

  it("sends the selected invitation status through the campaign contract", async () => {
    const requests = stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });
    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await settle();
    await chooseAudience(container, "speaker_invitations");
    const status = controlFor<HTMLSelectElement>(container, "Invitation status");
    await act(() => {
      status.value = "accepted";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await composeAndPreview(container);
    const request = requests.find((item) => item.method === "POST" && item.path.endsWith("/previews"));
    expect(eventEmailCampaignPreviewInputSchema.parse(request?.body).filter).toMatchObject({
      audience: "speaker_invitations",
      invitationStatus: "accepted",
    });
  });

  it("keeps the draft but requires a new preview when the audience changes", async () => {
    stubCampaignFetch({ previews: () => json(PREVIEW_BODY) });
    const container = mount(<EventEmailCampaign campaignsPath={CAMPAIGN_PATH} daysPath={`${EVENT_PATH}/days`} />);
    await composeAndPreview(container);
    expect(confirmationBox(container)).not.toBeNull();

    await chooseAudience(container, "attendee_invitations");
    expect(confirmationBox(container)).toBeNull();
    expect(controlFor<HTMLInputElement>(container, "Subject").value).toBe("Working group update");
    expect(controlFor<HTMLSelectElement>(container, "Invitation status").value).toBe("all");
  });

  it("does not render campaign management without the server-provided manage capability", () => {
    const event: GroupEvent = {
      id: EVENT_ID,
      ownerGroupId: GROUP_ID,
      seriesId: null,
      slug: "read-only-event",
      basePath: null,
      name: "Read-only event",
      timezone: "UTC",
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-01T18:00:00.000Z",
      profileKey: "workshop",
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      inviteLimitAttendee: 5,
      city: null,
      country: null,
      meetingLocation: null,
      links: [],
      nextOccurrenceAt: null,
      updatedAt: "2026-08-29T08:00:00.000Z",
      proposalAccess: null,
      capabilities: ["view"],
    };
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="communications" />);
    expect(container.textContent).not.toContain("Email campaigns");
  });
});

describe("generated virtual room template variable", () => {
  it("can be discovered for every event campaign audience with a usable preview", () => {
    for (const audience of eventEmailCampaignAudienceSchema.options) {
      expect(availableHelperLabelsForAudience(audience).has("virtualRoomUrl")).toBe(true);
    }
    expect(TEMPLATE_HELPERS.find((helper) => helper.label === "virtualRoomUrl")?.snippet).toBe("{{virtualRoomUrl}}");
    expect(PREVIEW_DEFAULTS.virtualRoomUrl).toBe("https://pkic.org/portal/#/events/conference/virtual");
  });
});
