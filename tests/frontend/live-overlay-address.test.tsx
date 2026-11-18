import { describe, expect, it } from "vitest";
import { liveOverlayAddress, parseLiveOverlayAddress } from "../../assets/ts/live-session/live-overlay-address";
import { ALL_LIVE_OVERLAY_GRAPHICS } from "../../assets/ts/live-session/live-overlay-graphics";

describe("a browser source's address", () => {
  it("keeps the whole address in the fragment, output and scene first", () => {
    const address = liveOverlayAddress("https://pkic.org", {
      view: "program",
      layout: "lower-third",
      slug: "pqc-2026",
      roomId: "33333333-3333-4333-8333-333333333333",
      token: "signed.overlay.access",
    });
    const url = new URL(address);
    expect(url.pathname).toBe("/live/overlay/");
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#view=program&layout=lower-third&event=/);
    expect(parseLiveOverlayAddress(url)).toEqual({
      view: "program",
      layout: "lower-third",
      slug: "pqc-2026",
      roomId: "33333333-3333-4333-8333-333333333333",
      token: "signed.overlay.access",
      graphics: ALL_LIVE_OVERLAY_GRAPHICS,
    });
    const fallback = new URL(address.replace("layout=lower-third", "layout=Not%20a%20name"));
    // A source that names no scene, or a malformed one, draws the scene its output has on air.
    expect(parseLiveOverlayAddress(fallback)?.layout).toBeNull();
    expect(
      new URL(liveOverlayAddress("https://pkic.org", { ...parseLiveOverlayAddress(url)!, layout: null })).hash,
    ).not.toContain("layout=");
    expect(
      new URL(liveOverlayAddress("https://pkic.org", { ...parseLiveOverlayAddress(url)!, layout: "full-frame" })).hash,
    ).toContain("layout=full-frame");
    expect(parseLiveOverlayAddress({ hash: url.hash.replace("view=program", "view=lower-third") })).toBeNull();
    expect(parseLiveOverlayAddress({ hash: "#view=program" })).toBeNull();
  });

  it("carries the graphics a source shows or hides, and crop, readable in the fragment", () => {
    const base = {
      view: "program" as const,
      layout: null,
      slug: "pqc-2026",
      roomId: "33333333-3333-4333-8333-333333333333",
      token: "signed.overlay.access",
    };
    const cropped = new URL(
      liveOverlayAddress("https://pkic.org", { ...base, graphics: { show: ["checkIn"], hide: null, crop: true } }),
    );
    expect(cropped.hash).toMatch(/^#view=program&show=checkIn&crop&event=/);
    expect(parseLiveOverlayAddress(cropped)?.graphics).toEqual({ show: ["checkIn"], hide: null, crop: true });
    const several = new URL(
      liveOverlayAddress("https://pkic.org", {
        ...base,
        graphics: { show: ["ticker", "checkIn"], hide: null, crop: false },
      }),
    );
    expect(several.hash).toContain("show=ticker,checkIn&event=");
    const hidden = new URL(
      liveOverlayAddress("https://pkic.org", {
        ...base,
        graphics: { show: null, hide: ["chat", "reactions"], crop: false },
      }),
    );
    expect(parseLiveOverlayAddress(hidden)?.graphics).toEqual({ show: null, hide: ["chat", "reactions"], crop: false });
    // Show wins over hide, and a show naming nothing the page knows draws nothing rather than everything.
    const both = { hash: hidden.hash.replace("hide=chat,reactions", "show=ticker&hide=chat") };
    expect(parseLiveOverlayAddress(both)?.graphics).toEqual({ show: ["ticker"], hide: null, crop: false });
    const unknown = { hash: hidden.hash.replace("hide=chat,reactions", "show=nonsense") };
    expect(parseLiveOverlayAddress(unknown)?.graphics.show).toEqual([]);
  });
});
