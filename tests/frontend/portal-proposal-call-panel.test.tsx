// @vitest-environment jsdom
/**
 * The call for proposals, at the top of an event's Proposals tab.
 *
 * What is asserted is what the panel adds: the status and the reason for it,
 * the window in the event's zone, who gets controls, and that Close now,
 * Reopen and Change dates send the shared contract's PATCH. The window editor
 * and the placement hook are the Settings panel's own, covered there.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTimeInZone } from "../../assets/shared/format-date";
import { groupEventFormPlacementUpdateSchema } from "../../assets/shared/schemas/group-event-forms";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { ProposalCallPanel } from "../../assets/ts/member-flows/portal/sections/management/ProposalCallPanel";
import { buttonNamed, buttonNames, controlFor, typeInto } from "./helpers/labelled-control";
import { confirmationButton, confirmationConsequences, requestClose } from "./helpers/confirm-dialog";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const FORM_ID = "30000000-0000-4000-8000-000000000001";
const PLACEMENT_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-10-09T12:00:00.000Z";
const REVISION = "2026-10-01T00:00:00.000Z";
const NEXT_REVISION = "2026-10-09T12:00:00.500Z";
const ZONE = "Europe/Amsterdam";
const OPENS = "2026-09-01T08:00:00.000Z";
const FUTURE_CLOSE = "2026-11-01T12:00:00.000Z";
const PAST_CLOSE = "2026-10-01T12:00:00.000Z";
const SUBMISSION_PATH = "/events/2026/amsterdam/propose/";
const PLACEMENT_URL = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/forms/proposal_submission`;
const mounted: HTMLElement[] = [];

function placement(window: { opensAt: string | null; closesAt: string | null } | null, eventUpdatedAt = REVISION) {
  return {
    eventUpdatedAt,
    purpose: "proposal_submission" as const,
    form: window
      ? {
          placement: {
            id: PLACEMENT_ID,
            formId: FORM_ID,
            ownerGroupId: GROUP_ID,
            contextType: "event",
            contextRef: EVENT_ID,
            audience: "speaker",
            active: true,
            ...window,
            createdAt: REVISION,
            updatedAt: REVISION,
          },
          form: { id: FORM_ID, key: "cfp", title: "Call for proposals form", description: null },
        }
      : null,
  };
}

function event(overrides: Partial<GroupEvent> = {}): GroupEvent {
  return {
    id: EVENT_ID,
    name: "PKI Consortium Conference Amsterdam",
    slug: "amsterdam",
    timezone: ZONE,
    sourceMode: "portal",
    capabilities: ["view", "manage"],
    endsAt: "2026-12-15T17:00:00.000Z",
    updatedAt: REVISION,
    proposalCall: { open: true, path: SUBMISSION_PATH },
    ...overrides,
  } as GroupEvent;
}

interface Request {
  method: string;
  url: string;
  body: unknown;
}
let requests: Request[] = [];

/** Serves the placement on GET and answers a PATCH with the window it was sent. */
function serve(initial: ReturnType<typeof placement>) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url: String(input), body });
      const response =
        method === "PATCH" && initial.form
          ? {
              ...initial,
              eventUpdatedAt: NEXT_REVISION,
              form: {
                ...initial.form,
                placement: { ...initial.form.placement, opensAt: body.opensAt, closesAt: body.closesAt },
              },
            }
          : initial;
      return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(node: ComponentChildren): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        {node}
      </>,
      container,
    ),
  );
  await settle();
  return container;
}

function panelOf(root: ParentNode): HTMLElement {
  const panel = root.querySelector<HTMLElement>('section[aria-label="Call for proposals"]');
  if (!panel) throw new Error("no Call for proposals panel");
  return panel;
}

async function press(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function patches(): Request[] {
  return requests.filter((request) => request.method === "PATCH");
}

function show(overrides: Partial<GroupEvent> = {}, onUpdated = vi.fn()) {
  return mount(
    <ProposalCallPanel
      event={event(overrides)}
      groupId={GROUP_ID}
      settingsHref="#/groups/g/events/e/settings"
      onUpdated={onUpdated}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("call for proposals panel", () => {
  it("shows an open call with its window in the event's zone and the submission page", async () => {
    serve(placement({ opensAt: OPENS, closesAt: FUTURE_CLOSE }));
    const panel = panelOf(await show());

    expect(panel.querySelector(".pk-badge")?.textContent).toBe("Open");
    expect(panel.textContent).toContain(formatDateTimeInZone(OPENS, ZONE));
    expect(panel.textContent).toContain(formatDateTimeInZone(FUTURE_CLOSE, ZONE));
    expect(panel.querySelector(`a[href="${SUBMISSION_PATH}"]`)).not.toBeNull();
    expect(buttonNames(panel)).toEqual(["Close now", "Change dates"]);
  });

  it("says since when a closed call is closed, and offers to reopen it", async () => {
    serve(placement({ opensAt: OPENS, closesAt: PAST_CLOSE }));
    const panel = panelOf(await show({ proposalCall: { open: false, path: null } }));

    expect(panel.querySelector(".pk-badge")?.textContent).toBe("Closed");
    expect(panel.textContent).toContain(`Closed since ${formatDateTimeInZone(PAST_CLOSE, ZONE)}`);
    expect(panel.querySelector(`a[href="${SUBMISSION_PATH}"]`)).toBeNull();
    expect(buttonNames(panel)).toEqual(["Reopen", "Change dates"]);
  });

  it("says when a scheduled call opens and that an ended event is closed", async () => {
    const opensLater = "2026-10-20T08:00:00.000Z";
    serve(placement({ opensAt: opensLater, closesAt: FUTURE_CLOSE }));
    const scheduled = panelOf(await show({ proposalCall: { open: false, path: null } }));
    expect(scheduled.textContent).toContain(`Not open yet. It opens ${formatDateTimeInZone(opensLater, ZONE)}`);
    expect(buttonNames(scheduled)).toEqual(["Change dates"]);

    serve(placement({ opensAt: OPENS, closesAt: null }));
    const ended = panelOf(
      await show({ endsAt: "2026-10-01T17:00:00.000Z", proposalCall: { open: false, path: null } }),
    );
    expect(ended.querySelector(".pk-badge")?.textContent).toBe("Closed");
    expect(ended.textContent).toContain("The event has ended.");
    expect(buttonNames(ended)).toEqual(["Change dates"]);
  });

  it("is not set up without a proposal form, and points to where one is chosen", async () => {
    serve(placement(null));
    const panel = panelOf(await show({ proposalCall: { open: false, path: null } }));

    expect(panel.querySelector(".pk-badge")?.textContent).toBe("Not set up");
    expect(panel.textContent).toContain("No proposal form has been chosen yet.");
    expect(panel.querySelector('a[href="#/groups/g/events/e/settings"]')?.textContent).toBe("Choose a proposal form");
    expect(buttonNames(panel)).toEqual([]);
    expect(panel.textContent).not.toContain("Opens");
  });

  it("is read-only for someone who cannot manage the event, without asking for the placement", async () => {
    serve(placement({ opensAt: OPENS, closesAt: FUTURE_CLOSE }));
    const panel = panelOf(await show({ capabilities: ["view"] }));

    expect(requests).toEqual([]);
    expect(panel.querySelector(".pk-badge")?.textContent).toBe("Open");
    expect(panel.querySelector(`a[href="${SUBMISSION_PATH}"]`)).not.toBeNull();
    expect(panel.querySelectorAll("button")).toHaveLength(0);
  });

  it("explains a website-defined event's call instead of offering controls it would refuse", async () => {
    serve(placement({ opensAt: OPENS, closesAt: FUTURE_CLOSE }));
    const panel = panelOf(await show({ sourceMode: "hugo" }));

    expect(requests).toEqual([]);
    expect(panel.querySelector(".pk-badge")?.textContent).toBe("Open");
    expect(panel.textContent).toContain(
      "This event's call for proposals is defined in the website content, so it can't be changed here yet.",
    );
    expect(panel.querySelectorAll("button")).toHaveLength(0);
  });

  it("closes the call now only after confirmation, keeping the opening and sending the shared PATCH", async () => {
    serve(placement({ opensAt: OPENS, closesAt: FUTURE_CLOSE }));
    const onUpdated = vi.fn();
    const root = await show({}, onUpdated);
    const panel = panelOf(root);

    await press(buttonNamed(panel, "Close now"));
    expect(confirmationConsequences()).toContain("You can reopen the call from this page.");
    requestClose();
    await settle();
    expect(patches()).toEqual([]);

    await press(buttonNamed(panel, "Close now"));
    await press(confirmationButton("Close now")!);

    expect(patches()).toHaveLength(1);
    const [patch] = patches();
    expect(patch.url).toBe(PLACEMENT_URL);
    expect(groupEventFormPlacementUpdateSchema.parse(patch.body)).toEqual({
      expectedUpdatedAt: REVISION,
      opensAt: OPENS,
      closesAt: NOW,
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("reopens a closed call by clearing the closing time", async () => {
    serve(placement({ opensAt: OPENS, closesAt: PAST_CLOSE }));
    const root = await show({ proposalCall: { open: false, path: null } });

    await press(buttonNamed(panelOf(root), "Reopen"));
    await press(confirmationButton("Reopen")!);

    expect(groupEventFormPlacementUpdateSchema.parse(patches()[0]?.body)).toEqual({
      expectedUpdatedAt: REVISION,
      opensAt: OPENS,
      closesAt: null,
    });
  });

  it("changes the dates in the event's zone through the same fields as Settings", async () => {
    serve(placement({ opensAt: OPENS, closesAt: FUTURE_CLOSE }));
    const root = await show();

    await press(buttonNamed(panelOf(root), "Change dates"));
    const dialog = root.querySelector<HTMLElement>("dialog")!;
    expect(dialog.textContent).toContain(`Event time (${ZONE})`);
    // 2026-09-01T08:00Z is 10:00 in Amsterdam (CEST).
    expect(controlFor(dialog, "Opens").value).toBe("2026-09-01T10:00");

    // December is CET, one hour behind CEST's offset: 10:00 local is 09:00Z.
    await typeInto(controlFor(dialog, "Closes"), "2026-12-01T10:00");
    await press(buttonNamed(dialog, "Save dates"));

    expect(groupEventFormPlacementUpdateSchema.parse(patches()[0]?.body)).toEqual({
      expectedUpdatedAt: REVISION,
      opensAt: OPENS,
      closesAt: "2026-12-01T09:00:00.000Z",
    });
  });
});
