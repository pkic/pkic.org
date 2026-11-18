import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBadgeCollection } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useBadgeCollection";
import type { EligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import { ScannerDestinationTiles } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerDestinationTiles";

const host = document.createElement("div");
document.body.append(host);
let collection: ReturnType<typeof useBadgeCollection>;
const lookupName = vi.fn<(credential: string) => Promise<string | null>>();
function Harness({ enabled = true, scope = "event:operator" }: { enabled?: boolean; scope?: string }) {
  collection = useBadgeCollection(enabled, { current: { lookupName } as unknown as EligibilityManifest }, scope);
  return null;
}
afterEach(async () => {
  await act(() => render(null, host));
  vi.restoreAllMocks();
  lookupName.mockReset();
});

describe("badge collection name lifecycle", () => {
  it("holds a name until Next attendee and ignores a late previous lookup", async () => {
    let finishFirst!: (name: string) => void;
    lookupName.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    lookupName.mockResolvedValueOnce("Zoë 山田");
    await act(() => render(<Harness />, host));
    await act(() => collection.begin("first"));
    expect(collection.held.current).toBe(true);
    await act(() => collection.clear());
    await act(async () => {
      collection.begin("second");
      await Promise.resolve();
    });
    expect(collection.name).toBe("Zoë 山田");
    await act(() => finishFirst("Previous person"));
    expect(collection.name).toBe("Zoë 山田");
    await act(() => collection.clear());
    expect(collection.name).toBeNull();
    expect(collection.held.current).toBe(false);
  });
  it("erases a name on operator change and backgrounding", async () => {
    lookupName.mockResolvedValue("Synthetic Attendee");
    await act(() => render(<Harness />, host));
    await act(async () => {
      collection.begin("code");
      await Promise.resolve();
    });
    expect(collection.name).toBe("Synthetic Attendee");
    await act(() => render(<Harness scope="event:other-operator" />, host));
    expect(collection.name).toBeNull();
    await act(async () => {
      collection.begin("code");
      await Promise.resolve();
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(collection.name).toBeNull();
    expect(collection.waiting).toBe(true);
  });
  it("does not look up names outside badge collection", async () => {
    await act(() => render(<Harness enabled={false} />, host));
    await act(async () => {
      collection.begin("code");
      await Promise.resolve();
    });
    expect(lookupName).not.toHaveBeenCalled();
    expect(collection.waiting).toBe(false);
  });
  it("shows the attendee with a Next attendee action instead of automatic advancement", async () => {
    const next = vi.fn();
    await act(() =>
      render(
        <FastScannerView
          context="Badge collection"
          mode="attendance"
          result={null}
          pending={1}
          message="Scan saved"
          cameraActive
          preview={false}
          onPreview={() => {}}
          onExit={() => {}}
          collection={{ waiting: true, name: "Zoë 山田", loading: false, onNext: next }}
        />,
        host,
      ),
    );
    expect(host.querySelector('[aria-label="Attendee name"]')?.textContent).toBe("Zoë 山田");
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "Next attendee");
    expect(button).toBeDefined();
    await act(() => button!.click());
    expect(next).toHaveBeenCalledOnce();
  });
  it("never offers badge collection to lead-only scanners", async () => {
    await act(() =>
      render(
        <ScannerDestinationTiles
          allowedActions={["lead"]}
          disabled={false}
          onVenue={() => {}}
          onSessions={() => {}}
          onCollection={() => {}}
        />,
        host,
      ),
    );
    expect(host.textContent).not.toContain("Badge collection");
  });
});
