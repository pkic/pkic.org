// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScannerLeadNote } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerLeadNote";
import { controlFor, typeInto } from "./helpers/labeled-control";

const leadId = "10000000-0000-4000-8000-000000000011";
const sponsorId = "10000000-0000-4000-8000-000000000012";
const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const match = [...root.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name);
  if (!match) throw new Error(`no button reads "${name}"`);
  return match;
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    render(null, container);
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("scanner lead note", () => {
  it("pauses capture while the note is open and saves it for the confirmed lead", async () => {
    const requests: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ note: "Asked for a demo.", noteUpdatedAt: "2026-10-04T10:00:00.000Z" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const onPause = vi.fn();
    const onSaved = vi.fn();
    const container = mount(
      <ScannerLeadNote
        slug="pqc-2026"
        sponsorId={sponsorId}
        confirmation={{ leadId, name: "Alex Example", title: null, organization: null, note: null }}
        onPause={onPause}
        onSaved={onSaved}
      />,
    );

    await click(button(container, "Add note"));
    expect(onPause).toHaveBeenLastCalledWith(true);
    expect(document.body.textContent).toContain("Note about Alex Example");
    await typeInto(controlFor<HTMLTextAreaElement>(document.body, "Note"), "Asked for a demo.");
    await click(button(document.body, "Save note"));

    expect(requests).toEqual([
      {
        url: `/api/v1/events/pqc-2026/sponsors/${sponsorId}/leads/${leadId}/note`,
        body: { note: "Asked for a demo." },
      },
    ]);
    expect(onSaved).toHaveBeenCalledWith(leadId, "Asked for a demo.");
    expect(onPause).toHaveBeenLastCalledWith(false);
  });

  it("refuses an overlong note at the field without sending it", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const onPause = vi.fn();
    const container = mount(
      <ScannerLeadNote
        slug="pqc-2026"
        sponsorId={sponsorId}
        confirmation={{ leadId, name: null, title: null, organization: null, note: "Earlier note" }}
        onPause={onPause}
        onSaved={vi.fn()}
      />,
    );

    await click(button(container, "Edit note"));
    const note = controlFor<HTMLTextAreaElement>(document.body, "Note");
    expect(note.value).toBe("Earlier note");
    await typeInto(note, "x".repeat(1001));
    await click(button(document.body, "Save note"));

    expect(fetcher).not.toHaveBeenCalled();
    expect(note.getAttribute("aria-invalid")).toBe("true");
    expect(document.body.textContent).toContain("Keep the note to 1,000 characters or fewer.");

    // Unmounting with the note open never leaves capture paused.
    render(null, container);
    expect(onPause).toHaveBeenLastCalledWith(false);
  });
});
