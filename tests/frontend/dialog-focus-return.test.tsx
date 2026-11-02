// @vitest-environment jsdom
/**
 * Focus goes back to the control that opened a dialog only after the dialog
 * has closed: while the modal is open the page behind it is inert, and a
 * browser refuses to focus anything there (#277).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { useId } from "preact/hooks";
import { Dialog } from "../../assets/ts/ui/Dialog";

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  // jsdom has the element but not its modal behavior; mirror the platform's open state.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function setup() {
  const trigger = document.createElement("button");
  trigger.textContent = "Settings";
  document.body.append(trigger);
  trigger.focus();
  // Record whether the modal was still open at the moment focus came back.
  let openWhenFocused: boolean | null = null;
  trigger.addEventListener("focus", () => {
    openWhenFocused = Boolean(host.querySelector("dialog[open]"));
  });
  const draw = (open: boolean, mounted = true) =>
    act(() =>
      render(
        mounted ? (
          <Dialog open={open} title="Settings" confirmLabel="Save" onConfirm={() => {}} onCancel={() => {}} />
        ) : null,
        host,
      ),
    );
  return { trigger, draw, openWhenFocused: () => openWhenFocused };
}

describe("Dialog focus return", () => {
  it("keeps its accessible name when a different render root owns the same local hook IDs", async () => {
    const other = document.createElement("div");
    document.body.prepend(other);
    function OtherRoot() {
      const id = useId();
      return <h2 id={`${id}-title`}>More</h2>;
    }
    try {
      await act(() => render(<OtherRoot />, other));
      const { draw, trigger } = setup();
      await draw(true);
      const dialog = host.querySelector("dialog")!;
      expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Settings");
      trigger.remove();
    } finally {
      render(null, other);
      other.remove();
    }
  });
  it("returns focus to the opener after the dialog closes", async () => {
    const { trigger, draw, openWhenFocused } = setup();
    await draw(true);
    (host.querySelector("dialog button") as HTMLButtonElement).focus();
    await draw(false);
    expect(document.activeElement).toBe(trigger);
    expect(openWhenFocused()).toBe(false);
    trigger.remove();
  });

  it("returns focus when the caller unmounts the open dialog", async () => {
    const { trigger, draw, openWhenFocused } = setup();
    await draw(true);
    (host.querySelector("dialog button") as HTMLButtonElement).focus();
    await draw(true, false);
    expect(document.activeElement).toBe(trigger);
    expect(openWhenFocused()).toBe(false);
    trigger.remove();
  });
});
