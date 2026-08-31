// @vitest-environment jsdom
/**
 * Avatar, PersonCell, and StatCard — identity and statistical presentation.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Avatar, initialsFrom } from "../../assets/ts/ui/Avatar";
import { PersonCell } from "../../assets/ts/ui/PersonCell";
import { StatCard } from "../../assets/ts/ui/StatCard";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("initialsFrom", () => {
  it("extracts first and last initials from a two-word name", () => {
    expect(initialsFrom("Sofia Beaumont")).toBe("SB");
  });

  it("handles three or more words by taking first and last", () => {
    expect(initialsFrom("Jelani Okonkwo II")).toBe("JI");
  });

  it("handles single-word names with one letter", () => {
    expect(initialsFrom("Prince")).toBe("P");
  });

  it("returns empty string for empty input", () => {
    expect(initialsFrom("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(initialsFrom("   ")).toBe("");
    expect(initialsFrom("\t\n")).toBe("");
  });

  it("collapses repeated whitespace before splitting", () => {
    expect(initialsFrom("Sofia   Beaumont")).toBe("SB");
  });

  it("handles non-ASCII letters like é and ñ", () => {
    expect(initialsFrom("José García")).toBe("JG");
  });

  it("handles Cyrillic characters", () => {
    expect(initialsFrom("Иван Петров")).toBe("ИП");
  });

  it("trims leading and trailing whitespace", () => {
    expect(initialsFrom("  Sofia Beaumont  ")).toBe("SB");
  });
});

describe("Avatar", () => {
  it("renders an image when src is provided", () => {
    const container = mount(<Avatar name="Sofia" src="https://example.com/avatar.jpg" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.src).toContain("example.com/avatar.jpg");
  });

  it("sets loading='lazy' on the image", () => {
    const container = mount(<Avatar name="Sofia" src="https://example.com/avatar.jpg" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("sets alt='' on the image (decorative)", () => {
    const container = mount(<Avatar name="Sofia" src="https://example.com/avatar.jpg" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("renders initials when src is not provided", () => {
    const container = mount(<Avatar name="Sofia Beaumont" />);
    const initials = container.querySelector(".pk-avatar__initials");
    expect(initials?.textContent).toBe("SB");
  });

  it("applies aria-hidden='true' to the whole element", () => {
    const container = mount(<Avatar name="Sofia" />);
    const avatar = container.querySelector(".pk-avatar");
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
  });

  it("applies size modifier at non-default sizes", () => {
    const smContainer = mount(<Avatar name="Sofia" size="sm" />);
    const smAvatar = smContainer.querySelector(".pk-avatar");
    expect(smAvatar?.className).toContain("pk-avatar--sm");

    const lgContainer = mount(<Avatar name="Sofia" size="lg" />);
    const lgAvatar = lgContainer.querySelector(".pk-avatar");
    expect(lgAvatar?.className).toContain("pk-avatar--lg");
  });

  it("omits size modifier at the default size", () => {
    const container = mount(<Avatar name="Sofia" size="md" />);
    const avatar = container.querySelector(".pk-avatar");
    expect(avatar?.className).not.toContain("pk-avatar--md");
  });

  it("handles empty name gracefully", () => {
    const container = mount(<Avatar name="" />);
    const initials = container.querySelector(".pk-avatar__initials");
    expect(initials?.textContent).toBe("");
  });
});

describe("PersonCell", () => {
  it("renders the avatar with the provided name", () => {
    const container = mount(<PersonCell name="Sofia Beaumont" email="sofia@example.com" />);
    const initials = container.querySelector(".pk-avatar__initials");
    expect(initials?.textContent).toBe("SB");
  });

  it("renders the name in a dedicated element", () => {
    const container = mount(<PersonCell name="Sofia Beaumont" email="sofia@example.com" />);
    const name = container.querySelector(".pk-person-cell__name");
    expect(name?.textContent).toBe("Sofia Beaumont");
  });

  it("renders the email when provided", () => {
    const container = mount(<PersonCell name="Sofia" email="sofia@example.com" />);
    const email = container.querySelector(".pk-person-cell__email");
    expect(email?.textContent).toBe("sofia@example.com");
  });

  it("does not render email element when email is not provided", () => {
    const container = mount(<PersonCell name="Sofia" />);
    const email = container.querySelector(".pk-person-cell__email");
    expect(email).toBeNull();
  });

  it("passes avatarSrc to the Avatar component", () => {
    const container = mount(
      <PersonCell name="Sofia" email="sofia@example.com" avatarSrc="https://example.com/sofia.jpg" />,
    );
    const img = container.querySelector("img");
    expect(img?.src).toContain("example.com/sofia.jpg");
  });

  it("applies size modifier at non-default sizes", () => {
    const container = mount(<PersonCell name="Sofia" size="sm" />);
    const cell = container.querySelector(".pk-person-cell");
    expect(cell?.className).toContain("pk-person-cell--sm");
  });

  it("omits size modifier at the default size", () => {
    const container = mount(<PersonCell name="Sofia" size="md" />);
    const cell = container.querySelector(".pk-person-cell");
    expect(cell?.className).not.toContain("pk-person-cell--md");
  });
});

describe("StatCard", () => {
  it("renders the label in uppercase", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" />);
    const label = container.querySelector(".pk-stat-card__label");
    expect(label?.textContent).toBe("Revenue");
  });

  it("renders the value", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" />);
    const value = container.querySelector(".pk-stat-card__value");
    expect(value?.textContent).toBe("$45,230");
  });

  it("renders the note when provided", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" note="+12%" />);
    const note = container.querySelector(".pk-stat-card__note");
    expect(note?.textContent).toContain("+12%");
  });

  it("does not render note element when note is not provided", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" />);
    const note = container.querySelector(".pk-stat-card__note");
    expect(note).toBeNull();
  });

  it("applies up trend styling and renders visually-hidden 'trending up'", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" note="+12%" trend="up" />);
    const note = container.querySelector(".pk-stat-card__note");
    expect(note?.className).toContain("pk-stat-card__note--up");

    const trendLabel = container.querySelector(".pk-stat-card__trend-label");
    expect(trendLabel?.textContent).toContain("trending up");
  });

  it("applies down trend styling and renders visually-hidden 'trending down'", () => {
    const container = mount(<StatCard label="Users" value="1,234" note="-8%" trend="down" />);
    const note = container.querySelector(".pk-stat-card__note");
    expect(note?.className).toContain("pk-stat-card__note--down");

    const trendLabel = container.querySelector(".pk-stat-card__trend-label");
    expect(trendLabel?.textContent).toContain("trending down");
  });

  it("applies flat trend styling and renders visually-hidden 'unchanged'", () => {
    const container = mount(<StatCard label="Churn" value="2.3%" note="No change" trend="flat" />);
    const note = container.querySelector(".pk-stat-card__note");
    expect(note?.className).toContain("pk-stat-card__note--flat");

    const trendLabel = container.querySelector(".pk-stat-card__trend-label");
    expect(trendLabel?.textContent).toContain("unchanged");
  });

  it("keeps the note readable when a trend is present — the note is the substance", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" note="+12%" trend="up" />);
    for (const span of container.querySelectorAll(".pk-stat-card__note span")) {
      expect(span.getAttribute("aria-hidden")).toBeNull();
    }
    expect(container.querySelector(".pk-stat-card__note")?.textContent).toContain("+12%");
  });

  it("does not hide note text when no trend is present", () => {
    const container = mount(<StatCard label="Revenue" value="$45,230" note="+12%" />);
    const noteSpans = container.querySelectorAll(".pk-stat-card__note > span");
    expect(noteSpans.length).toBe(1);
    expect(noteSpans[0]?.getAttribute("aria-hidden")).toBeNull();
    expect(container.querySelector(".pk-stat-card__note")?.className).not.toContain("--flat");
  });

  it("links to the rows behind the number without swallowing them into the name", () => {
    const container = mount(
      <StatCard label="Registrations" value="412" note="6 this quarter" href="/events/x/registrations" />,
    );
    const link = container.querySelector<HTMLAnchorElement>(".pk-stat-card__link");
    expect(link?.getAttribute("href")).toBe("/events/x/registrations");
    // Wrapping the whole card would announce "Registrations 412 6 this
    // quarter" as the link's name. The label alone is the name; the ::after
    // makes the card the target.
    expect(link?.textContent).toBe("Registrations");
    expect(container.querySelector(".pk-stat-card")?.className).toContain("pk-stat-card--link");
  });

  it("stays a plain card when there is nowhere to go", () => {
    const container = mount(<StatCard label="Registrations" value="412" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".pk-stat-card")?.className).not.toContain("pk-stat-card--link");
  });
});
