// @vitest-environment jsdom
/**
 * The registration setup for one event: four disclosures, each in its own
 * panel.
 *
 * `<details>` is kept rather than rebuilt — it is already a disclosure the
 * keyboard and a screen reader both understand — so what is worth asserting is
 * the part the markup used to get wrong: that the section says which event it
 * configures, that each disclosure is named and starts in the right state, and
 * that the proposal-questions panel is absent for an event the portal does not
 * own. The four editors are stubbed: what is under test is the shell.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventConfiguration } from "../../assets/ts/member-flows/portal/sections/management/GroupEventConfiguration";

/**
 * Each stub records the props it was handed, so a case can assert what the
 * shell passed down — the optimistic-concurrency token especially — and can
 * call `onRevision` the way a real editor does after a save.
 */
interface EditorProps {
  expectedUpdatedAt: string;
  onRevision: (nextUpdatedAt: string) => void;
}
const terms: EditorProps[] = [];
const settings: EditorProps[] = [];
const days: EditorProps[] = [];

vi.mock("../../assets/ts/member-flows/portal/sections/management/EventTermsEditor", () => ({
  EventTermsEditor: (props: EditorProps) => {
    terms.push(props);
    return <p>terms editor</p>;
  },
}));
vi.mock("../../assets/ts/member-flows/portal/sections/management/EventRegistrationSettingsEditor", () => ({
  EventRegistrationSettingsEditor: (props: EditorProps) => {
    settings.push(props);
    return <p>registration settings editor</p>;
  },
}));
vi.mock("../../assets/ts/member-flows/portal/sections/management/EventFormPlacementEditor", () => ({
  EventFormPlacementEditor: () => <p>form placement editor</p>,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/management/EventDaysEditor", () => ({
  EventDaysEditor: (props: EditorProps) => {
    days.push(props);
    return <p>days editor</p>;
  },
}));

const NOW = "2026-08-31T09:00:00.000Z";

function event(overrides: Partial<GroupEvent> = {}): GroupEvent {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    name: "PQC Conference 2026",
    slug: "pqc-2026",
    sourceMode: "portal",
    updatedAt: NOW,
    ...overrides,
  } as GroupEvent;
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

/** Every disclosure's summary text, in document order. */
function disclosureNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("summary")].map((summary) => summary.textContent ?? "");
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
  terms.length = 0;
  settings.length = 0;
  days.length = 0;
});

describe("group event registration configuration", () => {
  it("names the section after the event it configures", () => {
    const config = mount(<GroupEventConfiguration event={event()} groupId="g1" />);

    const section = config.querySelector("section");
    expect(section?.getAttribute("aria-label")).toBe("Configure PQC Conference 2026 registration");
  });

  it("gives every disclosure a name and opens the two that always apply", () => {
    const config = mount(<GroupEventConfiguration event={event()} groupId="g1" />);

    expect(disclosureNames(config)).toEqual([
      "Terms and conditions",
      "Policy and registration questions",
      "Proposal submission questions",
      "Attendance days",
    ]);
    // A disclosure is a real control, not a div with a handler: the platform
    // owns its state, and the two that always apply start open.
    expect([...config.querySelectorAll("details")].map((details) => details.open)).toEqual([true, true, false, false]);
  });

  it("hides the proposal-questions panel for an event the portal does not own", () => {
    // Form placements are configurable only for a portal-sourced event, so for
    // one that came from Hugo the disclosure is absent rather than present and
    // inert. ("external" is not in the vocabulary — the modes are hugo,
    // portal and integration.)
    const config = mount(<GroupEventConfiguration event={event({ sourceMode: "hugo" })} groupId="g1" />);

    expect(disclosureNames(config)).toEqual([
      "Terms and conditions",
      "Policy and registration questions",
      "Attendance days",
    ]);
    expect(config.textContent).not.toContain("form placement editor");
  });

  it("carries a child's new revision forward to the others, so the next save is not a 409", () => {
    // Each editor sends its own optimistic-concurrency token. If a save in one
    // did not update the token the others hold, the second save would be
    // rejected as a conflict against a revision that no longer exists.
    const onUpdated = vi.fn();
    mount(<GroupEventConfiguration event={event()} groupId="g1" onUpdated={onUpdated} />);

    expect(terms.at(-1)?.expectedUpdatedAt).toBe(NOW);
    expect(days.at(-1)?.expectedUpdatedAt).toBe(NOW);

    const NEXT = "2026-08-31T09:00:01.000Z";
    void act(() => terms.at(-1)!.onRevision(NEXT));

    expect(settings.at(-1)?.expectedUpdatedAt).toBe(NEXT);
    expect(days.at(-1)?.expectedUpdatedAt).toBe(NEXT);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });
});
