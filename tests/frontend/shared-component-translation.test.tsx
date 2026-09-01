// @vitest-environment jsdom
/**
 * The layer between the design system and the surfaces.
 *
 * Separate from the presentation-component suite because it tests a different
 * thing: not what a component draws, but how the portal's own vocabulary —
 * its status names, its column shapes, its offsets — is translated into the
 * system's. A translation is right or wrong for reasons a rendering test
 * cannot see.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { AuditLogTable } from "../../assets/ts/components/AuditLogTable";
import { Markdown } from "../../assets/ts/components/Markdown";
import { PersonCell } from "../../assets/ts/components/PersonCell";
import { StatCard } from "../../assets/ts/components/StatCard";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("shared component translation layer", () => {
  it("PersonCell falls back to a placeholder name and omits the second line when nothing is on file", () => {
    const container = mount(<PersonCell firstName={null} lastName={null} email={null} />);
    expect(container.textContent).toContain("—");
    // The face repeats what the name says, so it is decoration rather than a
    // second announcement of the same person.
    expect(container.querySelector(".pk-avatar")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".pk-person-cell__email")).toBeNull();
  });

  it("PersonCell keeps the email as the quiet second line unless it is already the name", () => {
    const named = mount(<PersonCell firstName="Ada" lastName="Lovelace" email="ada@example.test" />);
    expect(named.querySelector(".pk-person-cell__name")?.textContent).toBe("Ada Lovelace");
    expect(named.querySelector(".pk-person-cell__email")?.textContent).toBe("ada@example.test");

    const unnamed = mount(<PersonCell firstName={null} lastName={null} email="ada@example.test" />);
    expect(unnamed.querySelector(".pk-person-cell__name")?.textContent).toBe("ada@example.test");
    expect(unnamed.querySelector(".pk-person-cell__email")).toBeNull();
  });

  it("StatCard states a bad figure in words rather than only tinting it", () => {
    const container = mount(<StatCard label="Failed Emails" value={3} note="1 bounced" variant="danger" />);
    expect(container.querySelector(".pk-stat-card__value")?.textContent).toBe("3");
    // The tint the Bootstrap version used is invisible to a reader who cannot
    // separate the hues, so the state is said instead.
    expect(container.querySelector(".pk-stat-card__note")?.textContent).toBe("Needs attention · 1 bounced");
  });

  it("StatCard leaves an ordinary figure unannotated and names its link with just the label", () => {
    const plain = mount(<StatCard label="Queued Emails" value={0} />);
    expect(plain.querySelector(".pk-stat-card__note")).toBeNull();

    const linked = mount(
      <StatCard label="Total Registrations" value={412} note="8 confirmed" href="#/registrations" />,
    );
    const link = linked.querySelector<HTMLAnchorElement>("a");
    // The whole card is the target, but the link's name stays "Total
    // Registrations" rather than the card's entire contents read aloud.
    expect(link?.textContent).toBe("Total Registrations");
    expect(link?.getAttribute("href")).toBe("#/registrations");
  });

  it("Markdown refuses an unsafe link target and keeps the text", () => {
    const container = mount(<Markdown markdown="[click me](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("Markdown names a video embed and renders a plain link as a link", () => {
    const embed = mount(<Markdown markdown="https://youtu.be/abc123" />);
    const frame = embed.querySelector<HTMLIFrameElement>("iframe");
    // An unnamed frame is announced as "frame", which says nothing about what
    // is inside it.
    expect(frame?.getAttribute("title")).toBe("Embedded video");
    expect(frame?.getAttribute("src")).toBe("https://www.youtube.com/embed/abc123");

    const linked = mount(<Markdown markdown="See [the policy](https://example.test/policy)." />);
    expect(linked.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("AuditLogTable names its table and says which history it is showing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ auditLog: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const container = mount(
      <AuditLogTable
        endpoint="/api/v1/groups/group-1/audit-log"
        caption="Group history"
        actionCell={(entry) => entry.action}
        detailsCell={() => null}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Four unnamed tables on a page are announced as four tables.
    expect(container.querySelector("caption")?.textContent).toBe("Group history");
    expect(container.textContent).toContain("No audit log entries.");
  });

  it("AuditLogTable states a failed history request as a sentence, not a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const container = mount(
      <AuditLogTable
        endpoint="/api/v1/groups/group-1/audit-log"
        actionCell={(entry) => entry.action}
        detailsCell={() => null}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    expect(container.querySelector("table")).toBeNull();
  });
});
