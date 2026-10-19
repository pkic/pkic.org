// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useContractForm } from "../../assets/ts/hooks/useContractForm";
import { useFormTabs } from "../../assets/ts/hooks/useFormTabs";
import { TabList } from "../../assets/ts/ui/TabList";
import { Field } from "../../assets/ts/ui/Field";
import { TextInput } from "../../assets/ts/ui/TextControl";
import { controlFor, typeInto } from "./helpers/labeled-control";

const contract = z.object({ name: z.string().min(1), website: z.string().url() });
const sections = [
  { id: "main", label: "Basics", fields: ["name"] },
  { id: "details", label: "Details", fields: ["website"] },
] as const;
const mounted: HTMLElement[] = [];
function Form() {
  const [draft, setDraft] = useState({ name: "Synthetic name", website: "" });
  const form = useContractForm(contract, draft);
  const tabs = useFormTabs(form, sections);
  return (
    <form {...form.handlers} onSubmit={(event) => event.preventDefault()}>
      <TabList label="Form sections" {...tabs.list} />
      <div {...tabs.panel("main")}>
        <Field label="Name" {...form.of("name")}>
          {(control) => (
            <TextInput
              {...control}
              name="name"
              value={draft.name}
              onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            />
          )}
        </Field>
      </div>
      <div {...tabs.panel("details")}>
        <Field label="Website" {...form.of("website")}>
          {(control) => (
            <TextInput
              {...control}
              name="website"
              value={draft.website}
              onInput={(event) => setDraft({ ...draft, website: event.currentTarget.value })}
            />
          )}
        </Field>
      </div>
      <button
        type="button"
        onClick={() => {
          if (!form.submit().data) tabs.revealErrors();
        }}
      >
        Save
      </button>
    </form>
  );
}
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  void act(() => render(<Form />, host));
  return host;
}
const tab = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((entry) => entry.textContent?.startsWith(name))!;
afterEach(() => {
  for (const host of mounted.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  history.replaceState(null, "", "/portal/#/form");
});

describe("canonical form section URL state", () => {
  it("opens a bookmarked section and restores it on remount without serializing fields", async () => {
    history.replaceState(null, "", "/portal/#/form?formSection=details&other=keep");
    const host = mount();
    expect(tab(host, "Details").getAttribute("aria-selected")).toBe("true");
    await typeInto(controlFor(host, "Website"), "https://private-draft.example.test");
    expect(location.hash).toBe("#/form?formSection=details&other=keep");
    await act(() => render(null, host));
    const refreshed = mount();
    expect(tab(refreshed, "Details").getAttribute("aria-selected")).toBe("true");
    expect(controlFor(refreshed, "Website").value).toBe("");
  });
  it("uses browser Back and Forward for sections while retaining the unsaved draft", async () => {
    history.replaceState(null, "", "/portal/#/form?other=keep");
    const host = mount();
    await typeInto(controlFor(host, "Name"), "Local unsaved name");
    await act(() => tab(host, "Details").click());
    expect(location.hash).toContain("formSection=details");
    history.back();
    await vi.waitFor(() => expect(tab(host, "Basics").getAttribute("aria-selected")).toBe("true"));
    expect(controlFor(host, "Name").value).toBe("Local unsaved name");
    expect(location.hash).toBe("#/form?other=keep");
    history.forward();
    await vi.waitFor(() => expect(tab(host, "Details").getAttribute("aria-selected")).toBe("true"));
    expect(location.hash).not.toContain("Local");
  });
  it("rejects unknown bookmarks and reveals and focuses a refused field without putting its value in the URL", async () => {
    history.replaceState(null, "", "/portal/#/form?formSection=unknown&other=keep");
    const host = mount();
    expect(tab(host, "Basics").getAttribute("aria-selected")).toBe("true");
    await act(() => host.querySelector<HTMLButtonElement>('button:not([role="tab"])')!.click());
    await vi.waitFor(() => expect(tab(host, "Details").getAttribute("aria-selected")).toBe("true"));
    const website = controlFor(host, "Website");
    await vi.waitFor(() => expect(document.activeElement).toBe(website));
    expect(website.getAttribute("aria-invalid")).toBe("true");
    expect(location.hash).toBe("#/form?formSection=details&other=keep");
    await act(() => tab(host, "Basics").click());
    expect(location.hash).toBe("#/form?other=keep");
    await act(() => tab(host, "Details").click());
    expect(website.getAttribute("aria-invalid")).toBe("true");
  });
});
