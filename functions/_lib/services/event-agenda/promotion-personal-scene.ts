import type { PersonalPromotionRenderData, PromotionMeasure, PromotionPage, PromotionText } from "./promotion-scene";
import { promotionMeasuredLines } from "./promotion-text";

/** Claude's landscape and square social cards share the carousel's measured scene and export adapters. */
export function layoutPersonalPromotion(
  data: PersonalPromotionRenderData,
  width: number,
  height: number,
  measure: PromotionMeasure,
): PromotionPage {
  const square = width === height;
  const { personal } = data;
  const person = personal.people[0];
  const style = personal.roleStyle ?? { color: "#ffffff", ink: "#0b0d0c", label: personal.heading, speaking: false };
  const bandTop = height - (square ? 190 : 140);
  const page: PromotionPage = {
    title: personal.eventName,
    texts: [],
    pictures: [],
    bars: [],
    index: 0,
    total: 1,
    width,
    height,
    social: { bandTop },
  };
  const fit = (
    value: string,
    x: number,
    top: number,
    boxWidth: number,
    boxHeight: number,
    maximum: number,
    bold = false,
    color = "#fff",
    role: PromotionText["role"] = "P",
    centered = false,
    mono = false,
  ) => {
    if (!value.trim()) return top;
    for (let size = maximum; size >= 1; size--) {
      const lines = value
        .split("\n")
        .flatMap((segment) => promotionMeasuredLines(segment, boxWidth, (line) => measure(line, size, bold, mono)));
      if (lines.length * size * 1.18 > boxHeight) continue;
      lines.forEach((line, index) =>
        page.texts.push({
          text: line,
          x: centered ? x + boxWidth / 2 : x,
          y: top + size + index * size * 1.18,
          size,
          bold,
          color,
          role,
          mono,
          ...(centered ? { anchor: "middle" as const } : {}),
        }),
      );
      return top + size + (lines.length - 1) * size * 1.18;
    }
    throw new Error("Personal promotion text does not fit the social card.");
  };
  const bar = (x: number, y: number, w: number, h: number, color: string) =>
    page.bars!.push({ x, y, width: w, height: h, color });
  fit(
    [personal.dates, personal.city || personal.location].filter(Boolean).join(" · "),
    330,
    square ? 70 : 66,
    width - 402,
    30,
    square ? 24 : 22,
    true,
    "#ffffff",
    "P",
    false,
    true,
  );
  const portraitSize = square ? 340 : 320;
  const portraitX = square ? (width - portraitSize) / 2 : 800;
  const portraitY = square ? 184 : 136;
  const portrait = person && data.portraits?.[person.userId];
  page.pictures.push({
    src: portrait ?? "",
    x: portraitX,
    y: portraitY,
    width: portraitSize,
    height: portraitSize,
    circle: true,
    ringColor: style.color === "#ffffff" ? "url(#accent)" : style.color,
    alt: person?.displayName ?? "Event participant",
  });
  if (!portrait) {
    const initials = (person?.displayName ?? "Event participant")
      .split(/\s+/u)
      .filter(Boolean)
      .map((word) => Array.from(word)[0])
      .filter(Boolean);
    const monogram = (initials.length > 1 ? [initials[0], initials.at(-1)] : initials)
      .join("")
      .toLocaleUpperCase("en-US");
    fit(
      monogram,
      portraitX,
      portraitY + portraitSize * 0.3,
      portraitSize,
      portraitSize * 0.45,
      portraitSize * 0.28,
      true,
      "#ffffff",
      "P",
      true,
    );
  }
  const chipWidth = Math.min(square ? 550 : 620, measure(style.label.toUpperCase(), square ? 24 : 22, true, true) + 36);
  const chipX = square ? (width - chipWidth) / 2 : 72;
  const chipY = square ? 514 : 158;
  bar(chipX, chipY, chipWidth, 42, style.color);
  fit(
    style.label.toUpperCase(),
    chipX + 14,
    chipY + 7,
    chipWidth - 28,
    28,
    square ? 24 : 22,
    true,
    style.ink,
    "P",
    false,
    true,
  );
  const name = person?.displayName ?? "Event participant";
  const nameBottom = fit(
    name,
    72,
    square ? 580 : 216,
    square ? width - 144 : 620,
    square ? 115 : 102,
    square ? 72 : name.length > 22 ? 60 : name.length > 14 ? 72 : 88,
    true,
    "#ffffff",
    "H1",
    square,
  );
  bar(square ? (width - 160) / 2 : 72, nameBottom + 16, 160, 8, "url(#accent)");
  const affiliationTop = square ? 728 : Math.max(330, nameBottom + 42);
  const affiliationBottom = fit(
    person?.affiliation ?? "",
    72,
    affiliationTop,
    square ? width - 144 : 620,
    square ? 50 : Math.min(62, 400 - affiliationTop),
    square ? 30 : 28,
    false,
    "#ffffff",
    "P",
    square,
  );
  const sessions = personal.sessions ?? [];
  if (sessions.length) {
    const lines =
      sessions.length === 1
        ? [sessions[0]!.title]
        : sessions.length === 2
          ? ["2 SESSIONS", ...sessions.map((session) => session.title)]
          : [`${sessions.length} SESSIONS`, sessions[0]!.title, `+ ${sessions.length - 1} more on the agenda`];
    const top = square ? 800 : Math.max(396, affiliationBottom + 18);
    fit(
      lines.join("\n"),
      square ? 110 : 92,
      top,
      square ? width - 220 : 600,
      bandTop - top - 16,
      sessions.length > 1 ? 24 : 26,
      false,
      "#ffffff",
      "P",
      square,
    );
    if (!square) bar(72, top, 6, bandTop - top - 16, style.color);
  }
  bar(0, bandTop, width, height - bandTop, style.color);
  fit(
    personal.eventName,
    72,
    bandTop + (square ? 28 : 20),
    square ? 630 : 620,
    square ? 76 : 57,
    square ? 28 : 26,
    true,
    style.ink,
    "H2",
  );
  fit(
    personal.location ?? "",
    72,
    height - (square ? 82 : 63),
    square ? 630 : 620,
    32,
    square ? 22 : 20,
    false,
    style.ink,
  );
  const action =
    style.speaking && sessions.length
      ? sessions.length > 1
        ? "Join my sessions"
        : "Join my session"
      : style.label === "Organizer" || style.label === "Staff" || style.label === "Sponsor"
        ? "Join us"
        : "Join me";
  const ctaX = square ? width - 332 : width - 456;
  const ctaY = bandTop + (square ? 40 : 26);
  bar(ctaX, ctaY, square ? 260 : 384, square ? 90 : 58, "#0b0d0c");
  const link = data.registrationUrl.replace(/^https?:\/\//u, "");
  if (square) {
    fit(action, ctaX + 20, ctaY + 12, 194, 32, 26, true);
    fit(link, ctaX + 20, ctaY + 52, 220, 24, 20, true, "#ffffff", "P", false, true);
  } else {
    fit(action, ctaX + 20, ctaY + 15, 135, 30, 22, true);
    fit(link, ctaX + 192, ctaY + 19, 172, 25, 18, true, "#ffffff", "P", false, true);
  }
  page.arrows = [
    { x: ctaX + (square ? 224 : 165), y: ctaY + (square ? 30 : 31), length: square ? 16 : 12, color: "#ffffff" },
  ];
  return page;
}
