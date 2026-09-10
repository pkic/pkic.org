// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../assets/ts/member-flows/meeting-join/App";
import { meetingEntryReturnUrl, meetingEntrySignInUrl } from "../../assets/shared/meeting-entry-navigation";
import { youtubeVideoEmbed } from "../../assets/shared/markdown-media";
import { meetingJoinLandingSchema, meetingJoinResponseSchema } from "../../assets/shared/schemas/meeting-entry";

const id = "80000000-0000-4000-8000-000000000001";
const landing = meetingJoinLandingSchema.parse({
  occurrence: {
    id,
    seriesId: "60000000-0000-4000-8000-000000000001",
    eventName: "Conference broadcast",
    startsAt: "2026-09-10T13:00:00.000Z",
    endsAt: "2026-09-10T14:00:00.000Z",
    location: "Online",
  },
  name: "Invited Participant",
  affiliation: "Example Organization",
  terms: [],
  landingRevision: "a".repeat(64),
});
const containers: HTMLElement[] = [];
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function mount() {
  vi.stubGlobal("location", { ...window.location, search: `?occurrence=${id}`, assign: vi.fn() });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  await act(async () => {
    render(<App invitation={null} />, container);
  });
  return container;
}
afterEach(() => {
  for (const container of containers.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("authenticated broadcast entry", () => {
  it.each([
    "https://youtu.be/jfKfPfyJRdk",
    "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    "https://www.youtube.com/live/jfKfPfyJRdk",
    "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk",
  ])("recognizes the supported broadcast URL %s", (url) => {
    expect(youtubeVideoEmbed(url)).toBe("https://www.youtube.com/embed/jfKfPfyJRdk");
  });
  it.each([
    "https://youtube.com.example.test/watch?v=secret",
    "javascript:alert(1)",
    "https://www.youtube.com/channel/a",
    "https://meet.example.test/room",
  ])("does not embed an unrelated destination %s", (url) => {
    expect(youtubeVideoEmbed(url)).toBeNull();
  });
  it("returns only to a validated occurrence on this site after sign-in", () => {
    expect(meetingEntrySignInUrl(id)).toBe(`/portal/#/meeting-entry/${id}`);
    expect(meetingEntryReturnUrl(`#/meeting-entry/${id}`)).toBe(`/meetings/join/?occurrence=${id}`);
    for (const hash of [
      "#/meeting-entry/https://evil.test",
      "#/meeting-entry/../evil",
      "#/meeting-entry/%2F%2Fevil.test",
      `#/meeting-entry/${id}?next=evil`,
      "#/users/current",
    ]) {
      expect(meetingEntryReturnUrl(hash)).toBeNull();
    }
  });
  it("reveals the player only after intentional entry and removes it when access is revoked", async () => {
    let revoked = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          revoked
            ? response({ error: { code: "MEETING_ACCESS_REVOKED", message: "Not eligible" } }, 403)
            : init?.method === "POST"
              ? response(
                  meetingJoinResponseSchema.parse({
                    confirmationId: "82000000-0000-4000-8000-000000000001",
                    confirmedAt: "2026-09-10T13:00:00.000Z",
                    redirectUrl: "https://www.youtube.com/live/jfKfPfyJRdk",
                  }),
                )
              : response(landing),
        ),
      ),
    );
    const container = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Conference broadcast"));
    expect(container.querySelector("iframe")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });
    await vi.waitFor(() =>
      expect(container.querySelector("iframe")?.src).toBe("https://www.youtube.com/embed/jfKfPfyJRdk"),
    );
    expect(container.textContent).toContain("Video not playing? Open on YouTube");
    expect(window.location.assign).not.toHaveBeenCalled();
    revoked = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(container.querySelector("iframe")).toBeNull());
    expect(container.textContent).toContain("viewing access could not be confirmed");
    expect(container.querySelector('a[href*="youtube"]')).toBeNull();
  });
  it("offers a sign-in path without disclosing a broadcast to an anonymous viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response({ error: { code: "UNAUTHORIZED", message: "Sign in required" } }, 401))),
    );
    const container = await mount();
    await vi.waitFor(() => expect(container.querySelector("a")?.getAttribute("href")).toBe(meetingEntrySignInUrl(id)));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Conference broadcast");
  });
});
