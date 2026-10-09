// @vitest-environment jsdom
import { renderToStringAsync } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { AgendaSpeaker } from "../../assets/ts/site/AgendaSpeaker";
import { Avatar } from "../../assets/ts/ui/Avatar";
import { userHeadshotFileQuerySchema } from "../../assets/shared/schemas/route-contracts-headshots";
import type { ContentAgendaSpeaker } from "../../assets/shared/site-agenda";

const PORTRAIT = "/api/v1/users/00000000-0000-4000-8000-000000000001/headshots/2026-01-01T00-00-00-000Z-abcd1234.jpg";

const speaker: ContentAgendaSpeaker = {
  name: "Synthetic Speaker",
  title: "Researcher",
  imageSrc: PORTRAIT,
};

async function render(node: preact.ComponentChild): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(<>{node}</>);
  return host;
}

/** Each srcset candidate must be a request the headshot route accepts. */
function candidates(image: Element): Array<{ path: string; width: string; descriptor: string }> {
  return (image.getAttribute("srcset") ?? "").split(", ").map((candidate) => {
    const [address, descriptor] = candidate.split(" ");
    const url = new URL(address!, "https://app.test");
    const query = userHeadshotFileQuerySchema.parse(Object.fromEntries(url.searchParams));
    return { path: url.pathname, width: query.width!, descriptor: descriptor! };
  });
}

describe("agenda speaker portraits", () => {
  it("request bounded renditions on session cards and keep the stored portrait for the profile dialog", async () => {
    const host = await render(<AgendaSpeaker speaker={speaker} profileId="speaker-profile-1" />);

    const card = host.querySelector(".pk-agenda-speaker__open .pk-avatar__img")!;
    expect(card.getAttribute("src")).toBe(`${PORTRAIT}?width=96`);
    // A card avatar states its own 2.5rem slot so the rendition is chosen before stylesheets load.
    expect(card.getAttribute("sizes")).toBe("2.5rem");
    expect(candidates(card)).toEqual([
      { path: PORTRAIT, width: "96", descriptor: "96w" },
      { path: PORTRAIT, width: "192", descriptor: "192w" },
      { path: PORTRAIT, width: "384", descriptor: "384w" },
    ]);
    expect(card.getAttribute("loading")).toBe("lazy");

    // The preview and the profile load once they are shown (agenda-deferred-images.test.tsx).
    const preview = host.querySelector("[data-agenda-speaker-preview] .pk-avatar__img")!;
    expect(preview.hasAttribute("src")).toBe(false);
    expect(preview.getAttribute("data-deferred-src")).toBe(`${PORTRAIT}?width=96`);

    const dialogPortrait = host.querySelector(".pk-agenda-speaker-profile__portrait .pk-avatar__img")!;
    expect(dialogPortrait.hasAttribute("src")).toBe(false);
    expect(dialogPortrait.getAttribute("data-deferred-src")).toBe(PORTRAIT);
    expect(dialogPortrait.hasAttribute("data-deferred-srcset")).toBe(false);
  });

  it("states the directory card's rendered width so its full-width portrait stays sharp", async () => {
    const host = await render(<AgendaSpeaker speaker={speaker} profileId="speaker-profile-2" directory />);

    const card = host.querySelector(".pk-agenda-speaker-directory__card .pk-avatar__img")!;
    expect(card.getAttribute("sizes")).toBe("auto, 20rem");
    expect(candidates(card).map((candidate) => candidate.width)).toEqual(["96", "192", "384"]);
  });

  it("keeps the version marker of an absolute portrait address and leaves other sources untouched", async () => {
    const versioned = await render(<Avatar name="Versioned" src={`https://app.test${PORTRAIT}?v=2026-01-01`} />);
    expect(versioned.querySelector("img")?.getAttribute("src")).toBe(
      `https://app.test${PORTRAIT}?v=2026-01-01&width=96`,
    );

    const published = await render(<Avatar name="Published" src="/_published/media/portrait.webp" />);
    const image = published.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/_published/media/portrait.webp");
    expect(image.hasAttribute("srcset")).toBe(false);
  });
});
