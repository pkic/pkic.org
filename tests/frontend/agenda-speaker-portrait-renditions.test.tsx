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
  affiliations: [{ title: "Researcher" }],
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
  it("request bounded renditions on session cards and in the profile dialog", async () => {
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

    // The profile header shows the portrait at avatar size, so it asks for a rendition too.
    const dialogPortrait = host.querySelector(".pk-agenda-speaker-profile__portrait .pk-avatar__img")!;
    expect(dialogPortrait.hasAttribute("src")).toBe(false);
    expect(dialogPortrait.getAttribute("data-deferred-src")).toBe(`${PORTRAIT}?width=96`);
    expect(dialogPortrait.getAttribute("data-deferred-srcset")).toContain(`${PORTRAIT}?width=384 384w`);
  });

  it("uses the stored portrait for the full-width directory card", async () => {
    const host = await render(<AgendaSpeaker speaker={speaker} profileId="speaker-profile-2" directory />);

    const card = host.querySelector(".pk-agenda-speaker-directory__card .pk-avatar__img")!;
    expect(card.getAttribute("src")).toBe(PORTRAIT);
    expect(card.getAttribute("sizes")).toBe("auto, 20rem");
    expect(card.hasAttribute("srcset")).toBe(false);
  });

  it("shows the title and organization in directory cards even when the organization has a logo", async () => {
    const host = await render(
      <AgendaSpeaker
        speaker={{
          ...speaker,
          affiliations: [
            {
              title: "Researcher",
              organization: { name: "Example Institute", logoSrc: "/example.svg", href: "/members/example/" },
            },
          ],
        }}
        profileId="speaker-directory-affiliation"
        directory
      />,
    );
    const card = host.querySelector(".pk-agenda-speaker-directory__card")!;
    expect(card.textContent).toContain("Researcher");
    expect(card.querySelector(".pk-agenda-speaker-affiliations__text strong")?.textContent).toBe("Example Institute");
    expect(card.querySelector("a")).toBeNull();
    expect(card.querySelector(".pk-affiliation-rotation")).toBeNull();
    // The logo is the shared avatar, named by its mark; the portrait is the other avatar on the card.
    const logo = card.querySelector(
      ".pk-agenda-speaker-directory__footer [role='img'][aria-label='Example Institute']",
    );
    expect(logo).not.toBeNull();
    expect(logo?.querySelector(".pk-avatar img")).not.toBeNull();
    expect(card.querySelector(".pk-agenda-speaker-affiliations--directory img")).toBeNull();
    expect(card.querySelectorAll(".pk-avatar")).toHaveLength(2);
  });

  it("omits empty affiliation rows and the footer when optional data is absent", async () => {
    const host = await render(
      <AgendaSpeaker speaker={{ name: "Guest Speaker", affiliations: [{}] }} profileId="guest-profile" directory />,
    );
    const card = host.querySelector(".pk-agenda-speaker-directory__card")!;
    expect(card.textContent).toContain("Guest Speaker");
    expect(card.querySelector(".pk-avatar__initials")?.textContent).toBe("GS");
    expect(card.querySelector(".pk-agenda-speaker-affiliations")).toBeNull();
    expect(card.querySelector(".pk-agenda-speaker-directory__footer")).toBeNull();
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
