// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";

const { initialize, dispose } = vi.hoisted(() => {
  const dispose = vi.fn();
  return { initialize: vi.fn(() => dispose), dispose };
});
vi.mock("../../assets/js/modules/local-time.js", () => ({ initLocalTime: initialize }));
let root: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", undefined);
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  vi.unstubAllGlobals();
});

it("retains the local-time scan on personal updates and refreshes it when agenda data or zone changes", async () => {
  const days: ContentAgendaDay[] = [{ date: "2026-12-01", locations: [], slots: [] }];
  async function update(source: ContentAgendaDay[], zone: string, label: string) {
    await act(() =>
      render(
        <ContentAgenda
          days={source}
          speakers={[]}
          timeZone={zone}
          personal={{ session: () => undefined, toolbarControls: <span>{label}</span> }}
        />,
        root,
      ),
    );
    await vi.dynamicImportSettled();
  }
  await update(days, "UTC", "First marks");
  expect(initialize).toHaveBeenCalledTimes(1);
  await update(days, "UTC", "Updated marks");
  expect(root.textContent).toContain("Updated marks");
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();

  const refreshed = structuredClone(days);
  await update(refreshed, "UTC", "Updated marks");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(initialize).toHaveBeenCalledTimes(2);
  await update(refreshed, "Europe/Amsterdam", "Updated marks");
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(initialize).toHaveBeenCalledTimes(3);
});
