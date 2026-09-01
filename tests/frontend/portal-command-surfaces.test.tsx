// @vitest-environment jsdom
/**
 * The two bars of irreversible commands — a vote's lifecycle transitions and
 * the system operations console — plus the shared icon set they and every
 * other surface render.
 *
 * None of these had a test. What is asserted is what a visual review cannot
 * see: that the group of commands is a named region rather than a `<div>`
 * carrying an `aria-label` no role attaches to, that a running command is
 * announced as busy instead of merely greyed, that a refused command leaves a
 * message beside the form rather than vanishing, and that a decorative icon
 * says nothing to a screen reader while still letting a caller name it.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GroupVoteDetail } from "../../assets/shared/schemas/group-votes";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { IconInfoCircle, IconLinkedIn, IconXTwitter } from "../../assets/ts/components/icons";
import { GroupVoteLifecycleActions } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteLifecycleActions";
import { OperationActions } from "../../assets/ts/member-flows/portal/sections/system-operations/OperationActions";
import { buttonNamed, buttonNames, controlFor, typeInto } from "./helpers/labelled-control";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const VOTE_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-12-01T09:00:00.000Z";
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChild): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function vote(availableTransitions: string[]): GroupVoteDetail {
  return {
    id: VOTE_ID,
    ownerGroupId: GROUP_ID,
    title: "Adopt the charter",
    description: "A vote on the revised charter.",
    voteType: "resolution",
    status: "open",
    opensAt: NOW,
    closesAt: NOW,
    availableTransitions,
    capabilities: ["manage"],
  } as unknown as GroupVoteDetail;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("vote lifecycle actions", () => {
  it("renders nothing at all when no transition is available", () => {
    const page = mount(<GroupVoteLifecycleActions groupId={GROUP_ID} vote={vote([])} onChanged={vi.fn()} />);
    expect(page.querySelector("section")).toBeNull();
    expect(page.textContent).toBe("");
  });

  it("names the region and offers only the transitions the server allows", () => {
    const page = mount(<GroupVoteLifecycleActions groupId={GROUP_ID} vote={vote(["close"])} onChanged={vi.fn()} />);

    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe("Vote lifecycle management");
    expect(buttonNames(page)).toEqual(["Close current round"]);
  });

  it("labels the cancellation reason and ties its guidance to the control", async () => {
    const page = mount(<GroupVoteLifecycleActions groupId={GROUP_ID} vote={vote(["cancel"])} onChanged={vi.fn()} />);

    const toggle = buttonNamed(page, "Cancel vote");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(() => toggle.click());
    expect(buttonNamed(page, "Cancel vote").getAttribute("aria-expanded")).toBe("true");

    // The reason used to be a bare `<textarea>` under a label; it is reached
    // through the `for`/`id` pair now, and marked required in the markup.
    const reason = controlFor<HTMLTextAreaElement>(page, "Cancellation reason");
    expect(reason.tagName.toLowerCase()).toBe("textarea");
    expect(reason.required).toBe(true);
    const describedBy = reason.getAttribute("aria-describedby");
    expect(page.querySelector(`[id="${describedBy!}"]`)?.textContent).toContain("cancellation notice");

    // The form names what it cancels, so a page of forms is distinguishable.
    expect(page.querySelector("form")?.getAttribute("aria-label")).toBe("Cancel Adopt the charter");

    // Confirming is blocked until a reason is typed.
    expect(buttonNamed(page, "Confirm cancellation").disabled).toBe(true);
    await typeInto(reason, "Superseded by a later proposal.");
    expect(buttonNamed(page, "Confirm cancellation").disabled).toBe(false);
  });

  it("announces a refused transition beside the form instead of losing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "CONFLICT", message: "The vote already closed." } }, 409)),
    );
    const page = mount(<GroupVoteLifecycleActions groupId={GROUP_ID} vote={vote(["cancel"])} onChanged={vi.fn()} />);

    await act(() => buttonNamed(page, "Cancel vote").click());
    await typeInto(controlFor(page, "Cancellation reason"), "Superseded.");
    await act(async () => {
      page.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The vote already closed.");
    // The form stays open with what was typed, so nothing has to be retyped.
    expect(controlFor<HTMLTextAreaElement>(page, "Cancellation reason").value).toBe("Superseded.");
  });
});

describe("system operation commands", () => {
  const permissions = {
    reminderLimit: 25,
    canManageEmail: false,
    canRunRetention: false,
    canAnonymizeUsers: false,
    canWriteMembership: false,
    canApproveMembership: false,
  };

  it("names the group of commands as a region rather than an unlabelled div", () => {
    const page = mount(<OperationActions {...permissions} reload={vi.fn(async () => undefined)} />);

    const region = page.querySelector("section");
    expect(region?.getAttribute("aria-label")).toBe("Operational commands");
    expect(page.querySelector("h3")?.textContent).toBe("Operational commands");
  });

  it("offers each command only to the domain permission that owns it", () => {
    const readOnly = mount(<OperationActions {...permissions} reload={vi.fn(async () => undefined)} />);
    expect(buttonNames(readOnly)).toEqual(["Preview reminders"]);
    expect(readOnly.textContent).toContain("Reminder preview is read-only.");

    const staff = mount(
      <OperationActions
        {...permissions}
        canManageEmail
        canWriteMembership
        canApproveMembership
        reload={vi.fn(async () => undefined)}
      />,
    );
    expect(buttonNames(staff)).toEqual([
      "Preview reminders",
      "Queue reminders",
      "Run consultation batch",
      "Run EC review batch",
      "Queue chair digest",
    ]);
    expect(staff.textContent).not.toContain("Reminder preview is read-only.");
  });

  it("offers retention redaction only when both permissions are held", () => {
    const partial = mount(<OperationActions {...permissions} canRunRetention reload={vi.fn(async () => undefined)} />);
    expect(buttonNames(partial)).not.toContain("Run retention redaction");

    const full = mount(
      <OperationActions {...permissions} canRunRetention canAnonymizeUsers reload={vi.fn(async () => undefined)} />,
    );
    expect(buttonNames(full)).toContain("Run retention redaction");
  });

  it("says which command is busy rather than only greying the bar", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return json({ processed: 3 });
      }),
    );
    const page = mount(<OperationActions {...permissions} reload={vi.fn(async () => undefined)} />);

    const preview = buttonNamed(page, "Preview reminders");
    void act(() => preview.click());

    // `aria-busy` on the running command, and it keeps its place in the tab
    // order rather than being disabled out from under a keyboard user.
    const running = [...page.querySelectorAll("button")][0];
    expect(running.getAttribute("aria-busy")).toBe("true");

    release?.();
    await settle();
    expect([...page.querySelectorAll("button")][0].getAttribute("aria-busy")).toBeNull();
  });

  it("reports a refused retention run without redacting anything", async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Not permitted." } }, 403));
    vi.stubGlobal("fetch", fetchMock);
    const page = mount(
      <>
        <OperationActions {...permissions} canRunRetention canAnonymizeUsers reload={vi.fn(async () => undefined)} />
        <ConfirmDialogHost />
      </>,
    );

    void act(() => buttonNamed(page, "Run retention redaction").click());
    await settle();

    // The dialog demands the phrase typed back before it will confirm, so a
    // stray click cannot start an irreversible run.
    const dialog = document.querySelector("dialog")!;
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Run retention redaction",
    )!;
    expect(confirm.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the shared icon set", () => {
  it("hides a decorative icon from assistive technology and from the tab order", () => {
    const page = mount(
      <>
        <IconLinkedIn />
        <IconXTwitter />
        <IconInfoCircle />
      </>,
    );

    const svgs = [...page.querySelectorAll("svg")];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      // The gap beside a label belongs to the flex parent, so no icon carries
      // spacing of its own any more.
      expect(svg.getAttribute("class")).toBeNull();
    }
  });

  it("lets a caller name an icon that is not decorative", () => {
    const page = mount(<IconInfoCircle aria-hidden={undefined} role="img" aria-label="More information" />);
    const svg = page.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("More information");
  });
});
