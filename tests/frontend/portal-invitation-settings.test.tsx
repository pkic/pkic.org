// @vitest-environment jsdom
/**
 * Settings → Registration → Invitation: the invitation wording, who can use
 * the link, and the peer invitation limit, each read as a summary and edited
 * in place through the event settings contract.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { InvitationSettingsTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/InvitationSettingsTab";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor, typeInto } from "./helpers/labeled-control";

const event = eventDetailSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  slug: "summit",
  name: "Summit",
  timezone: "Europe/Amsterdam",
  startsAt: null,
  endsAt: null,
  profileKey: "conference",
  registrationPolicy: "public",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: "2026-08-29T00:00:00.000Z",
  basePath: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  city: null,
  country: null,
  sessionTypes: null,
  ownerGroupId: null,
  sourceMode: "portal",
  seriesId: null,
  links: [],
  registrationPath: null,
  capabilities: ["read", "write"],
  settings: {},
});
let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

async function submit(panel: string) {
  await act(async () => {
    root
      .querySelector(`[aria-label="${panel}"] form`)!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function mount() {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ event });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => render(<InvitationSettingsTab event={event} onUpdated={() => {}} />, root));
  return sent;
}

it("shows the default invitation wording and saves the event's own", async () => {
  const sent = await mount();
  expect(root.textContent).toContain("You're invited to Summit (default)");
  expect(root.textContent).toContain("No message.");

  await beginRecordEdit(root, "Invitation message actions");
  await typeInto(controlFor<HTMLInputElement>(root, "Headline"), "Join the PQC migration");
  await typeInto(controlFor<HTMLTextAreaElement>(root, "Message"), "Two days of **hands-on** sessions.");
  await submit("Invitation message");
  expect(eventSettingsUpdateSchema.parse(sent[0]).invitationMessage).toEqual({
    headline: "Join the PQC migration",
    message: "Two days of **hands-on** sessions.",
  });
});

it("reads the peer invitation limit and saves a new one, refusing one above 50", async () => {
  const sent = await mount();
  expect(root.textContent).toContain("5 per attendee");

  await beginRecordEdit(root, "Peer invitation actions");
  const limit = controlFor<HTMLInputElement>(root, "Peer invitation limit");
  await typeInto(limit, "51");
  await submit("Peer invitations");
  expect(sent).toHaveLength(0);

  await typeInto(limit, "0");
  await submit("Peer invitations");
  expect(eventSettingsUpdateSchema.parse(sent[0]).inviteLimitAttendee).toBe(0);
});
