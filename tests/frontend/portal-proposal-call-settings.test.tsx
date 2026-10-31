// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDetailSchema, eventSettingsUpdateSchema } from "../../assets/shared/schemas/event-management";
import { ProposalCallSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/ProposalCallSettings";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor, typeInto } from "./helpers/labeled-control";

const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-08-29T00:00:00.000Z";
const event = eventDetailSchema.parse({
  id,
  slug: "website-conference",
  name: "Website conference",
  timezone: "Europe/Amsterdam",
  startsAt: null,
  endsAt: null,
  profileKey: "conference",
  registrationPolicy: "public",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: at,
  basePath: "/events/website-conference/",
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  city: null,
  country: null,
  sessionTypes: null,
  ownerGroupId: null,
  sourceMode: "hugo",
  seriesId: null,
  links: [],
  capabilities: ["read", "write"],
  settings: {},
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
let root: HTMLElement;
afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  vi.unstubAllGlobals();
});

it("shows the saved website call first and sends the event wall clock as UTC after explicit editing", async () => {
  let captured: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        captured = JSON.parse(String(init.body));
        return json({ event });
      }
      return json({
        event: { id, slug: event.slug, name: event.name },
        purpose: "proposal_submission",
        registrationPolicy: "public",
        requiredTerms: [],
        allowedSessionTypes: ["Talk"],
        eventDays: [],
        form: {
          id,
          key: "website-proposals",
          title: "Proposal form",
          description: null,
          fields: [],
          placement: {
            id,
            formId: id,
            ownerGroupId: null,
            contextType: "event",
            contextRef: id,
            audience: "speaker",
            active: true,
            opensAt: "2026-10-15T08:00:00.000Z",
            closesAt: "2026-11-15T09:00:00.000Z",
            createdAt: at,
            updatedAt: at,
          },
        },
      });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(async () => {
    render(<ProposalCallSettings event={event} onUpdated={() => {}} />, root);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(root.querySelector('input[type="datetime-local"]')).toBeNull();
  expect(root.textContent).toContain("Europe/Amsterdam");
  await beginRecordEdit(root, "Call for proposals actions", "Edit CFP settings");
  const opens = controlFor<HTMLInputElement>(root, "Opens");
  expect(opens.value).toBe("2026-10-15T10:00");
  await typeInto(opens, "2026-10-16T10:00");
  await act(async () => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(eventSettingsUpdateSchema.parse(captured).proposalSubmissionWindow).toEqual({
    opensAt: "2026-10-16T08:00:00.000Z",
    closesAt: "2026-11-15T09:00:00.000Z",
  });
});

it.each([true, false])(
  "offers CFP setup without a linked form only to an authorized group manager (can edit: %s)",
  async (canEdit) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          event: { id, slug: event.slug, name: event.name },
          purpose: "proposal_submission",
          registrationPolicy: "public",
          requiredTerms: [],
          allowedSessionTypes: [],
          eventDays: [],
          form: null,
        }),
      ),
    );
    root = document.createElement("div");
    document.body.append(root);
    await act(() =>
      render(
        <ProposalCallSettings
          event={{ ...event, capabilities: ["read"] }}
          onUpdated={() => {}}
          groupSettings={{ groupId: id, eventId: id, canEdit, onSaved: () => {} }}
        />,
        root,
      ),
    );
    await vi.waitFor(() => expect(root.textContent).toContain("No proposal form"));
    expect(Boolean(root.querySelector('button[aria-label="Call for proposals actions"]'))).toBe(canEdit);
    if (canEdit) {
      await beginRecordEdit(root, "Call for proposals actions", "Edit CFP settings");
      expect(root.querySelector('[role="combobox"]')).not.toBeNull();
    }
  },
);
