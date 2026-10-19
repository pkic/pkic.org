// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { badgeFaceLayout } from "../../assets/shared/badge-print-layout";
import { BadgeFace } from "../../assets/ts/components/event-badges/BadgeFace";
import { badgeFaceHtml, badgePrintHtml } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { badgeFaceBadge, badgeFacePrinting } from "./helpers/badge-face-fixture";

let host: HTMLDivElement | null = null;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe("the shared badge face renderer", () => {
  it("is the print document for one badge on a page of the badge's printed size", async () => {
    const badge = await badgeFaceBadge();
    const printing = badgeFacePrinting();
    const face = badgeFaceHtml(badge, printing);
    expect(face).toMatchObject({ widthMm: 105, heightMm: 148 });
    expect(face.html).toBe(badgePrintHtml([badge], badgeFaceLayout(105, 148), printing, "event_badge"));
    expect(face.html).toContain("@page{size:105mm 148mm;margin:0}");
    expect(face.html).toContain("badge-template-qr");
    expect(face.html).toContain(encodeURIComponent("ABCD-EFGH-JKLM-NPQR"));
    expect(face.html).toContain('aria-label="Synthetic Sponsor"');
    expect(face.html).toContain("SPEAKER");
    expect(face.html.match(/aria-label="Badge (front|back)"/g)).toEqual(['aria-label="Badge front"']);
  });

  it("shows the face at true size when it fits and keeps its proportions when scaled to a narrow column", async () => {
    const badge = await badgeFaceBadge();
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<BadgeFace badge={badge} printing={badgeFacePrinting()} title="Your badge" />, host!));
    const wrapper = host.querySelector(".pk-badge-face")!;
    expect(wrapper.classList.contains("pk-badge-face--portrait")).toBe(true);
    const frame = host.querySelector<HTMLIFrameElement>("iframe.pk-badge-face__frame")!;
    expect(frame.getAttribute("title")).toBe("Your badge");
    expect([frame.width, frame.height]).toEqual(["396", "559"]);
    expect(frame.getAttribute("srcdoc")).toContain("badge-template-qr");
    expect(frame.getAttribute("srcdoc")).toContain('aria-label="Synthetic Sponsor"');

    render(null, host);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    await act(() => render(<BadgeFace badge={badge} printing={badgeFacePrinting()} title="Your badge" />, host!));
    const narrow = host.querySelector<HTMLIFrameElement>("iframe.pk-badge-face__frame")!;
    expect(Number(narrow.width)).toBe(300);
    expect(Number(narrow.height) / Number(narrow.width)).toBeCloseTo(148 / 105, 2);
  });
});
