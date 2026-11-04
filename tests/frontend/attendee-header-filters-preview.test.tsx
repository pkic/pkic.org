// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { AttendeeHeaderFiltersPreview } from "../../assets/ts/ui/preview/AttendeeHeaderFiltersPreview";
import { menuPath } from "./helpers/menu-path";
import { chooseColumnFilter } from "./helpers/column-menu";
const host = document.createElement("div");
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});
it("applies consent filters to the gallery population and restores matching rows", async () => {
  document.body.append(host);
  await act(() => render(<AttendeeHeaderFiltersPreview />, host));
  expect(host.textContent).toContain("Alex Example");
  await chooseColumnFilter(host, "Consent", "Without consent");
  expect(host.textContent).not.toContain("Alex Example");
  await chooseColumnFilter(host, "Consent", "With consent");
  expect(host.textContent).toContain("Alex Example");
});

it("keeps cleared all-days filters open and disables unavailable example CSV destinations", async () => {
  document.body.append(host);
  await act(() => render(<AttendeeHeaderFiltersPreview />, host));
  const allDays = await menuPath(host, "Attendance column options", ["Days", "All selected days"]);
  await act(() => allDays.click());
  const date = await menuPath(host, "Attendance column options", ["Days", "Dec 1"]);
  await act(() => date.click());
  expect(host.textContent).toContain("Alex Example");
  const clear = await menuPath(host, "Attendance column options", ["Days", "All days"]);
  await act(() => clear.click());
  expect(host.textContent).toContain("Alex Example");
  const download = await menuPath(host, "Actions for matching attendees", ["Download", "CSV", "Attendees"]);
  expect(download.hasAttribute("href")).toBe(false);
  expect((download as HTMLButtonElement).disabled).toBe(true);
});
