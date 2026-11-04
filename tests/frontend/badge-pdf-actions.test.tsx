// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BadgePrintPreview } from "../../assets/ts/components/event-badges/BadgePrintPreview";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../assets/shared/badge-label-policy";
import { createGenericBadgeTemplate } from "../../assets/shared/badge-generic-template";
import { downloadBadgeArtifact } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { badgePrintPdf } from "../../assets/ts/components/event-badges/badge-print-pdf";

vi.mock("../../assets/ts/components/event-badges/badge-print-pdf", () => ({ badgePrintPdf: vi.fn() }));
vi.mock("../../assets/ts/components/event-badges/badge-print-artifacts", async (load) => ({
  ...(await load<typeof import("../../assets/ts/components/event-badges/badge-print-artifacts")>()),
  downloadBadgeArtifact: vi.fn(),
}));
vi.mock("../../assets/ts/components/event-badges/BadgeDocumentFrame", async () => {
  const { useEffect } = await import("preact/hooks");
  return {
    BadgeDocumentFrame: ({
      frameRef,
      html,
      onReady,
    }: {
      frameRef: { current: HTMLIFrameElement | null };
      html: string;
      onReady: () => void;
    }) => {
      useEffect(() => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        frameRef.current = frame;
        onReady();
        return () => {
          frame.remove();
          frameRef.current = null;
        };
      }, [html]);
      return null;
    },
  };
});
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  vi.mocked(downloadBadgeArtifact).mockClear();
  vi.mocked(badgePrintPdf).mockReset();
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});

it.each([
  ["label_pdf", true],
  ["label_pdf", false],
  ["badge_pdf", true],
  ["badge_pdf", false],
] as const)("rechecks authorization after preparing %s before releasing its file: %s", async (action, allowed) => {
  let finish!: (file: Blob) => void;
  let authorized = true;
  const beforeRelease = vi.fn(async () => authorized);
  vi.mocked(badgePrintPdf).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const context = {
    revision: "a".repeat(64),
    template: createGenericBadgeTemplate({ eventName: "Synthetic conference", sponsorGroups: [] }),
    branding: [],
  };
  await act(() =>
    render(
      <BadgePrintPreview
        action={action}
        printing={BADGE_LABEL_PRINTING_CONTEXT}
        loadPrintingContext={async () => context}
        badges={[
          {
            id: "one",
            displayName: "Alex Example",
            firstName: "Alex",
            lastName: "Example",
            organization: "Example Trust Systems",
            badgeRole: "speaker",
            credential: "ABCDEFGHJKLMNPQR",
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M1 1h5v5H1z"/></svg>',
          },
        ]}
        beforeRelease={beforeRelease}
      />,
      host,
    ),
  );
  await vi.waitFor(() => expect(badgePrintPdf).toHaveBeenCalledTimes(1));
  expect(beforeRelease).not.toHaveBeenCalled();
  authorized = allowed;
  await act(async () => finish(new Blob(["%PDF-1.7"], { type: "application/pdf" })));
  await vi.waitFor(() => expect(beforeRelease).toHaveBeenCalledTimes(1));
  if (allowed) {
    expect(downloadBadgeArtifact).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadBadgeArtifact).mock.calls[0]).toEqual([
      expect.any(Blob),
      "application/pdf",
      action === "badge_pdf" ? "attendee-badges.pdf" : "attendee-labels.pdf",
    ]);
  } else expect(downloadBadgeArtifact).not.toHaveBeenCalled();
});
