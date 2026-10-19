// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { confirmAction, ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";

const hosts: HTMLElement[] = [];

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(<ConfirmDialogHost />, host);
  return host;
}

afterEach(() => {
  for (const host of hosts.splice(0)) render(null, host);
  document.body.innerHTML = "";
});

describe("confirmation host", () => {
  it("opens one dialog when a page mounts several hosts", async () => {
    // A registration page mounts a host for its photo tile and another for its sponsor sharing.
    const first = mountHost();
    const second = mountHost();
    let answer: Promise<boolean> | undefined;
    await act(() => {
      answer = confirmAction({ title: "Cancel your registration?", confirmLabel: "Cancel registration" });
    });
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(first.querySelector("dialog")).not.toBeNull();
    expect(second.querySelector("dialog")).toBeNull();
    await act(() => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "Cancel registration")!
        .click();
    });
    await expect(answer).resolves.toBe(true);
    expect(document.querySelectorAll("dialog")).toHaveLength(0);
  });
});
