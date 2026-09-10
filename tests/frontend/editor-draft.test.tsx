// @vitest-environment jsdom
/**
 * When a draft begins, and what may write to it afterwards.
 *
 * Records now open read-only and the fields appear only once somebody takes
 * the edit command (#47), which puts a question under every editor: what does
 * the draft hold when it opens, and what happens to it while it is open.
 *
 * Two answers are wrong in opposite directions. An editor that reseeds from
 * the record on every render of that record retypes the fields under somebody
 * mid-sentence the moment anything reloads — a background refresh, a sibling
 * save. An editor that seeds once at mount shows, when reopened later, a
 * draft from before the record changed. `useEditorDraft` answers with the
 * only moment that is neither: the transition from closed to open.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useEditorDraft } from "../../assets/ts/hooks/useEditorDraft";

function Editor({ editing, name }: { editing: boolean; name: string }) {
  const [draft, setDraft] = useEditorDraft(editing, () => ({ name }));
  if (!editing) return <p>closed</p>;
  return (
    <input
      name="name"
      value={draft.name}
      onInput={(event) => setDraft({ name: (event.target as HTMLInputElement).value })}
    />
  );
}

let host: HTMLElement | null = null;

function mount(props: { editing: boolean; name: string }): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(<Editor {...props} />, host!));
  return host;
}

function rerender(props: { editing: boolean; name: string }): void {
  void act(() => render(<Editor {...props} />, host!));
}

function field(): HTMLInputElement {
  const input = host!.querySelector<HTMLInputElement>('input[name="name"]');
  if (!input) throw new Error("the editor is not open");
  return input;
}

function type(value: string): void {
  const input = field();
  input.value = value;
  void act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
});

describe("useEditorDraft", () => {
  it("seeds the draft from the record when the editor opens", () => {
    mount({ editing: false, name: "Ada" });
    expect(host!.textContent).toBe("closed");

    rerender({ editing: true, name: "Ada" });
    expect(field().value).toBe("Ada");
  });

  it("keeps what somebody is typing when the record reloads underneath them", () => {
    mount({ editing: true, name: "Ada" });
    type("Ada Lovelace");

    // The same record arriving again — a refetch, a poll, a sibling save
    // refreshing the page it sits on. It is not an instruction to retype.
    rerender({ editing: true, name: "Ada" });
    expect(field().value).toBe("Ada Lovelace");

    // Nor is a genuinely newer copy of it: while the editor is open the
    // draft is the person's, and the reader decides what to do with it.
    rerender({ editing: true, name: "Grace" });
    expect(field().value).toBe("Ada Lovelace");
  });

  it("starts again from the record the next time it is opened", () => {
    mount({ editing: true, name: "Ada" });
    type("abandoned");

    rerender({ editing: false, name: "Grace" });
    rerender({ editing: true, name: "Grace" });

    // Not "abandoned", which was discarded with the editor, and not "Ada",
    // which is what the record said the previous time it was opened.
    expect(field().value).toBe("Grace");
  });
});
