import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scannerPreferencesSchema } from "../../assets/shared/schemas/event-scanner-preferences";
import { useScannerPreferences } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerPreferences";
import { ScannerPacing } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerPacing";

const key = "pkic-scanner-preferences";
let host: HTMLDivElement;
function Preferences() {
  const preferences = useScannerPreferences();
  return (
    <ScannerPacing
      value={preferences.feedbackPause}
      onChange={(feedbackPause) => preferences.update({ feedbackPause })}
      field={preferences.form.of("feedbackPause")}
    />
  );
}
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  localStorage.clear();
});

it.each([null, { sound: false, feedbackPause: 300 }])(
  "uses one second for new and former default settings (%j)",
  async (saved) => {
    if (saved) localStorage.setItem(key, JSON.stringify(saved));
    await act(() => render(<Preferences />, host));
    expect(host.querySelector("select")!.value).toBe("1000");
  },
);

it("saves longer feedback pauses and preserves an explicit current shorter choice", async () => {
  localStorage.setItem(key, JSON.stringify(scannerPreferencesSchema.parse({ feedbackPause: 300 })));
  await act(() => render(<Preferences />, host));
  const select = host.querySelector("select")!;
  expect(select.value).toBe("300");
  expect([...select.options].map((option) => option.value)).toEqual(
    expect.arrayContaining(["1000", "2000", "5000", "10000"]),
  );
  await act(() => {
    select.value = "5000";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(scannerPreferencesSchema.parse(JSON.parse(localStorage.getItem(key)!)).feedbackPause).toBe(5000);
  await act(() => render(null, host));
  await act(() => render(<Preferences />, host));
  expect(host.querySelector("select")!.value).toBe("5000");
});
