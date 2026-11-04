// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { AttendeeHeaderFiltersPreview } from "../../assets/ts/ui/preview/AttendeeHeaderFiltersPreview";
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
