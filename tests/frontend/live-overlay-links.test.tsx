// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { LiveOverlayLinks } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveOverlayLinks";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

it("loads the room's output links at once, one compact row per output, the link shown only when copying fails", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ token: "signed", expiresAt: "2026-12-04T17:00:00.000Z" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    render(
      <LiveOverlayLinks slug="pqc-2026" roomId="room-1" layout={{ slug: "full-frame", name: "Full frame" }} />,
      host!,
    ),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-copy-link-row]")).not.toBeNull());
  expect(fetch).toHaveBeenCalledTimes(1);
  const dialog = host!;
  const rows = [...dialog.querySelectorAll<HTMLElement>("[data-copy-link-row]")];
  expect(rows.map((row) => row.querySelector("span")?.textContent)).toContain("Program");
  // No long link fields until a copy fails.
  expect(dialog.querySelector("[data-copy-link]")).toBeNull();
  expect(dialog.querySelector('button[aria-label="Copy the Program link"]')).not.toBeNull();
  expect(dialog.textContent).toContain("These links stay the same");
});

it("offers Try again when the links fail to load, and loads them on a retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unavailable" } }), { status: 503 }))
    .mockResolvedValue(
      new Response(JSON.stringify({ token: "signed", expiresAt: "2026-12-04T17:00:00.000Z" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    render(
      <LiveOverlayLinks slug="pqc-2026" roomId="room-1" layout={{ slug: "full-frame", name: "Full frame" }} />,
      host!,
    ),
  );
  const retry = await vi.waitFor(() => {
    const button = [...host!.querySelectorAll("button")].find((candidate) => candidate.textContent === "Try again");
    expect(button).toBeDefined();
    return button!;
  });
  await act(async () => retry.click());
  await vi.waitFor(() => expect(host!.querySelector("[data-copy-link-row]")).not.toBeNull());
  expect(fetch).toHaveBeenCalledTimes(2);
});
