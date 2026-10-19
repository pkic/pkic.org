import { describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { observeStaticImageFallbacks } from "../../assets/ts/site/static-image-fallbacks";
import { AgendaSpeakerOrganizationLogo } from "../../assets/ts/site/AgendaSpeakerAffiliations";

it("uses organization text silently when a mounted logo cannot load", async () => {
  const host = document.createElement("div");
  await act(() =>
    render(
      <AgendaSpeakerOrganizationLogo
        organization={{ name: "Example Institute", logoSrc: "/missing.svg" }}
        size="card"
      />,
      host,
    ),
  );
  await act(() => {
    host.querySelector("img")!.dispatchEvent(new Event("error"));
  });
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".pk-avatar__initials")?.textContent).toBe("EI");
  render(null, host);
});

describe("static public image fallbacks", () => {
  it("preserves initials and organization text when public assets are unavailable", () => {
    const host = document.createElement("section");
    host.innerHTML =
      '<div data-avatar-fallback="GS"><img src="/missing.jpg"></div><span class="pk-agenda-speaker-organization"><img src="/missing.svg" alt="Example Institute"></span>';
    const cleanup = observeStaticImageFallbacks(host);
    host.querySelectorAll("img").forEach((image) => image.dispatchEvent(new Event("error")));
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(host.querySelector(".pk-avatar__initials")?.textContent).toBe("GS");
    expect(host.textContent).toContain("Example Institute");
    cleanup();
  });
});
