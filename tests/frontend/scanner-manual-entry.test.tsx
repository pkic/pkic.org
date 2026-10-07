// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { ScannerManualEntry } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerManualEntry";

let host: HTMLDivElement;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host));
    host.remove();
  }
});

function ManualEntry() {
  const [open, setOpen] = useState(false);
  const [badgeId, setBadge] = useState("");
  return (
    <>
      <button type="button">Other control</button>
      <ScannerManualEntry
        open={open}
        onOpen={setOpen}
        badgeId={badgeId}
        onBadge={setBadge}
        field={{}}
        action="attendance"
        busy={false}
      />
    </>
  );
}

it("focuses the real badge input on opening and reopening, preserving controlled entry across renders", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<ManualEntry />, host));
  const details = host.querySelector("details")!;
  const input = host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
  const other = host.querySelector<HTMLButtonElement>("button")!;
  other.focus();
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(other);
  expect(host.querySelector("label")?.textContent).toContain("Badge code");

  await act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(document.activeElement).toBe(input);
  const badgeId = "abcd-efgh-jklm-npqr";
  await act(() => {
    input.value = badgeId;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector('input[name="badgeId"]')).toBe(input);
  expect(input.value).toBe(badgeId);
  expect(host.textContent).toContain("Spaces and hyphens are optional.");
  expect(host.textContent).not.toContain("credential reference");
  expect(document.activeElement).toBe(input);
  expect(host.querySelector('button[type="submit"]')?.textContent).toBe("Record attendance");

  await act(() => {
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });
  other.focus();
  await act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe(badgeId);
});
