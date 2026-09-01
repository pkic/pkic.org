// @vitest-environment jsdom
/**
 * The group vote-proposal form, on its own.
 *
 * `portal-group-vote-management.test.tsx` covers the happy path through the
 * proposals list; this covers what that file does not — what the form says
 * when the server rejects a submission, and what it exposes to a reader who
 * never sees it.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupVoteProposalCreateSchema } from "../../assets/shared/schemas/group-vote-proposals";
import { GroupVoteProposalForm } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteProposalForm";
import { buttonNamed, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container));
  mounted.push(container);
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group vote proposal form", () => {
  it("names every control through a for/id pair and marks only the required ones", () => {
    const container = mount(<GroupVoteProposalForm groupId={GROUP_ID} onCreated={() => Promise.resolve()} />);

    expect(labelNames(container)).toEqual([
      "Title",
      "Type",
      "Description",
      "Proposed opening time",
      "Proposed closing time",
    ]);
    // Resolving through the pair means the lookup fails exactly when the
    // labelling is broken, which is the part worth asserting.
    expect(controlFor(container, "Title").required).toBe(true);
    expect(controlFor<HTMLTextAreaElement>(container, "Description").required).toBe(true);
    // "(optional)" used to live in the label. The help text says it instead,
    // and it is wired to the control it describes rather than floating beside
    // it, so a screen reader reads the two together.
    const opens = controlFor(container, "Proposed opening time");
    expect(opens.required).toBe(false);
    const describedBy = opens.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(container.querySelector(`#${describedBy!}`)?.textContent).toContain("Leave empty");
  });

  it("takes every field out of play while the submission is in flight", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(Response.json({ proposal: null }));
          }),
      ),
    );

    const container = mount(<GroupVoteProposalForm groupId={GROUP_ID} onCreated={() => Promise.resolve()} />);
    await typeInto(controlFor(container, "Title"), "Architecture proposal");
    await typeInto(controlFor<HTMLTextAreaElement>(container, "Description"), "Adopt the architecture.");
    await act(() => buttonNamed(container, "Submit proposal").click());

    // One disabled fieldset rather than a `disabled` prop on each control, so
    // a field added later cannot forget to opt in.
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    // `aria-busy` is what says the save is in flight to a reader who cannot
    // see the spinner.
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.getAttribute("aria-busy")).toBe("true");
    expect(submit?.textContent).toBe("Submitting…");

    release?.();
    await settle();
  });

  it("announces a rejected submission and keeps what was typed", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) => {
        if (init.body) bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(new Response("Proposals are closed for this group.", { status: 409 }));
      }),
    );

    const created = vi.fn(() => Promise.resolve());
    const container = mount(<GroupVoteProposalForm groupId={GROUP_ID} onCreated={created} />);
    await typeInto(controlFor(container, "Title"), "Architecture proposal");
    await typeInto(controlFor<HTMLTextAreaElement>(container, "Description"), "Adopt the architecture.");
    await act(() => buttonNamed(container, "Submit proposal").click());
    await settle();

    // Parsed through the shared request contract rather than compared to a
    // literal, so the assertion fails if the payload stops being a valid one.
    expect(groupVoteProposalCreateSchema.parse(bodies[0])).toMatchObject({
      title: "Architecture proposal",
      description: "Adopt the architecture.",
      voteType: "motion",
    });

    // The failure is announced, not only coloured, and the draft survives so
    // the reader does not have to type it all again.
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    expect(controlFor(container, "Title").value).toBe("Architecture proposal");
    expect(created).not.toHaveBeenCalled();
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });
});
