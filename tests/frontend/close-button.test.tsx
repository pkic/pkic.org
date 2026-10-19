// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseButton } from "../../assets/ts/ui/CloseButton";
import { BottomSheet } from "../../assets/ts/ui/BottomSheet";
import { AgendaSpeakerProfile } from "../../assets/ts/site/AgendaSpeakerProfile";
import { AgendaSession } from "../../assets/ts/site/AgendaSession";
import { AgendaSourcesPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSourcesPanel";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
});

function mount(children: ComponentChildren) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<>{children}</>, host));
  return host;
}

function staticHost(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** The one shared close control: the cross icon in the same square, named "Close …". */
function expectSharedClose(control: Element | null | undefined, label: string) {
  expect(control).toBeTruthy();
  expect(control!.tagName).toBe("BUTTON");
  expect(control!.getAttribute("aria-label")).toBe(label);
  expect([...control!.classList].filter((name) => name.startsWith("pk-btn") || name.startsWith("pk-close"))).toEqual(
    expect.arrayContaining(["pk-btn", "pk-btn--ghost", "pk-btn--icon", "pk-close"]),
  );
  expect(control!.querySelector("svg.pk-icon path")?.getAttribute("d")).toBe("m4 4 8 8M12 4l-8 8");
  expect(control!.textContent).toBe("");
}

describe("shared close control", () => {
  it("names what it closes and closes it", async () => {
    const onClick = vi.fn();
    const host = mount(<CloseButton label="Close preview" onClick={onClick} />);
    const control = host.querySelector("button")!;
    expectSharedClose(control, "Close preview");
    expect(control.getAttribute("type")).toBe("button");
    expect(control.title).toBe("Close preview");
    await act(() => control.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("brings its own backdrop over an image", () => {
    const host = mount(<CloseButton label="Close photo" overMedia />);
    expect(host.querySelector("button")!.classList.contains("pk-close--over-media")).toBe(true);
  });

  it("closes the session details", () => {
    const host = staticHost(
      renderToString(
        <AgendaSession
          session={{
            id: "s1",
            title: "Synthetic session",
            descriptionHtml: "<p>Abstract.</p>",
            locations: ["blue"],
            speakers: [],
          }}
          slot={{ startsAt: "2027-01-20T09:00:00.000Z" }}
          locations={[{ id: "blue", label: "Blue hall" }]}
          dialogId="details"
          timeZone="UTC"
        />,
      ),
    );
    const closers = host.querySelectorAll("dialog#details button[aria-label^='Close']");
    expect(closers).toHaveLength(1);
    expectSharedClose(closers[0], "Close session details");
  });

  it("closes a speaker profile from the session details' header tools", () => {
    const host = staticHost(
      renderToString(<AgendaSpeakerProfile speaker={{ name: "Synthetic Speaker" }} profileId="profile" />),
    );
    const closers = host.querySelectorAll("dialog#profile button[aria-label^='Close']");
    expect(closers).toHaveLength(1);
    expectSharedClose(closers[0], "Close speaker profile");
    expect(closers[0].closest(".session-modal__tools")).not.toBeNull();
  });

  it("closes a bottom sheet", async () => {
    const onClose = vi.fn();
    const host = mount(
      <BottomSheet open={false} title="Filters" onClose={onClose}>
        <p>Sheet body</p>
      </BottomSheet>,
    );
    const control = host.querySelector(".pk-sheet__head button");
    expectSharedClose(control, "Close filters");
    await act(() => (control as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalled();
  });

  it("closes a portal side panel", async () => {
    const onClose = vi.fn();
    const host = mount(
      <AgendaSourcesPanel id="sources" open onClose={onClose}>
        <p>Sources</p>
      </AgendaSourcesPanel>,
    );
    const control = host.querySelector("#sources header button");
    expectSharedClose(control, "Close session sources");
  });
});
