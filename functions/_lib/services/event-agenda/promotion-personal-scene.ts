import { initialsFrom } from "../../../../assets/shared/initials";
import type { PersonalPromotionRenderData, PromotionMeasure, PromotionPage, PromotionText } from "./promotion-scene";
import { promotionBalancedLines, promotionMeasuredLines } from "./promotion-text";

type TextStyle = {
  size: number;
  weight: 400 | 500 | 600 | 700;
  mono?: boolean;
  tracking?: number;
  lineHeight?: number;
  balance?: boolean;
  maxLines?: number;
};
/** Mirror the source's flex layout; only overflow cases scale down to keep automatic cards usable. */
export function layoutPersonalPromotion(
  data: PersonalPromotionRenderData,
  width: number,
  height: number,
  measure: PromotionMeasure,
): PromotionPage {
  const square = width === height,
    { personal } = data,
    person = personal.people[0];
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
    social: { bandTop, focalPoint: square ? { x: 0.62, y: 0.4 } : { x: 0.5, y: 0.55 } },
  };
  const textWidth = (text: string, s: TextStyle) =>
    measure(text, s.size, s.weight >= 600, s.mono, s.weight) + (s.tracking ?? 0) * s.size * Array.from(text).length;
  const block = (value: string, s: TextStyle, boxWidth: number) => {
    const m = measure.metrics?.(s.size, s.weight >= 600, s.mono, s.weight) ?? {
      ascent: s.size * 0.93,
      descent: -s.size * 0.24,
      lineGap: 0,
    };
    const lineHeight = s.lineHeight ? s.size * s.lineHeight : m.ascent - m.descent + m.lineGap;
    const baseline = m.ascent + (lineHeight - (m.ascent - m.descent)) / 2;
    const split = s.balance ? promotionBalancedLines : promotionMeasuredLines;
    let lines = value.trim() ? split(value, boxWidth, (line) => textWidth(line, s)) : [];
    if (s.maxLines && lines.length > s.maxLines) {
      lines = lines.slice(0, s.maxLines);
      let last = lines.at(-1)!;
      while (last && textWidth(last + "…", s) > boxWidth) last = Array.from(last).slice(0, -1).join("");
      lines[lines.length - 1] = last.trimEnd() + "…";
    }
    return {
      lines,
      s,
      lineHeight,
      baseline,
      height: lines.length * lineHeight,
      width: Math.max(0, ...lines.map((line) => textWidth(line, s))),
    };
  };
  const put = (
    b: ReturnType<typeof block>,
    x: number,
    y: number,
    color = "#ffffff",
    role: PromotionText["role"] = "P",
    center = false,
  ) =>
    b.lines.forEach((text, index) =>
      page.texts.push({
        text,
        x,
        y: y + b.baseline + index * b.lineHeight,
        size: b.s.size,
        bold: b.s.weight >= 600,
        weight: b.s.weight,
        mono: b.s.mono,
        letterSpacing: (b.s.tracking ?? 0) * b.s.size,
        color,
        role,
        ...(center ? { anchor: "middle" as const } : {}),
      }),
    );
  const bar = (x: number, y: number, w: number, h: number, color: string) =>
    page.bars!.push({ x, y, width: w, height: h, color });
  const dates = [personal.dates, personal.city || personal.location]
    .filter(Boolean)
    .join(" · ")
    .toLocaleUpperCase("en-US");
  let header = block(dates, { size: square ? 24 : 22, weight: 500, mono: true, tracking: 0.1 }, width - 402);
  for (let size = header.s.size; header.lines.length > 1 && size > 10; size--)
    header = block(dates, { ...header.s, size }, width - 402);
  put(header, width - 72 - header.width, (square ? 64 : 60) + ((square ? 48 : 44) - header.height) / 2);
  const sessions = personal.sessions ?? [];
  const sessionLines =
    sessions.length === 1
      ? [sessions[0]!.title]
      : sessions.length === 2
        ? sessions.map((s) => s.title)
        : sessions.length > 2
          ? [sessions[0]!.title, `+ ${sessions.length - 1} more on the agenda`]
          : [];
  const name = person?.displayName ?? "Event participant";
  const baseName = square ? (name.length > 22 ? 60 : 72) : name.length > 22 ? 60 : name.length > 14 ? 72 : 88;
  const profile = (factor: number) => {
    const role = block(
      style.label.toUpperCase(),
      { size: (square ? 24 : 22) * factor, weight: 600, mono: true, tracking: 0.16 },
      square ? 800 : 592,
    );
    const nameBlock = block(
      name,
      { size: baseName * factor, weight: 700, lineHeight: 1, tracking: -0.03, balance: true },
      square ? width - 144 : 620,
    );
    const affiliation = block(
      person?.affiliation ?? "",
      { size: (square ? 30 : 28) * factor, weight: 500, lineHeight: 1.25 },
      square ? width - 144 : 620,
    );
    const count =
      sessions.length > 1
        ? block(
            `${sessions.length} SESSIONS`,
            { size: (square ? 22 : 20) * factor, weight: 600, mono: true, tracking: 0.12 },
            square ? 860 : 598,
          )
        : null;
    const topics = sessionLines.map((line) =>
      block(
        line,
        {
          size: (square ? 28 : sessions.length > 1 ? 24 : 26) * factor,
          weight: 400,
          lineHeight: 1.25,
          maxLines: square || sessions.length > 1 ? 1 : 2,
        },
        square ? 860 : 598,
      ),
    );
    const topicBlocks = [...(count ? [count] : []), ...topics];
    const topicHeight =
      topicBlocks.reduce((n, b) => n + b.height, 0) + Math.max(0, topicBlocks.length - 1) * 6 * factor;
    const gap = (square ? 16 : 18) * factor;
    const children =
      (square ? 360 : role.height + 16 * factor) +
      nameBlock.height +
      8 +
      affiliation.height +
      (topicBlocks.length ? topicHeight : 0);
    const gaps = gap * ((affiliation.lines.length ? 3 : 2) + (topicBlocks.length ? 1 : 0));
    return {
      factor,
      role,
      nameBlock,
      affiliation,
      topicBlocks,
      topicHeight,
      gap,
      height: children + gaps + (square ? 28 * factor : topicBlocks.length ? 6 * factor : 0),
    };
  };
  const profileTop = square ? 136 : 128,
    profileHeight = square ? height - 342 : 350;
  let p = profile(1);
  for (const factor of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25]) {
    if (p.height <= profileHeight + 4) break;
    p = profile(factor);
  }
  if (p.height > profileHeight + 4) throw new Error("Personal promotion text does not fit the social card.");
  let y = profileTop + (profileHeight - p.height) / 2;
  const portraitSize = square ? 340 : 320,
    ringWidth = square ? 10 : 8;
  const portraitX = square ? (width - portraitSize) / 2 : 800;
  const portraitY = square ? y + 10 : 136;
  const portrait = person && data.portraits?.[person.userId];
  page.pictures.push({
    src: portrait ?? "",
    x: portraitX,
    y: portraitY,
    width: portraitSize,
    height: portraitSize,
    circle: true,
    ringWidth,
    ringColor: style.color === "#ffffff" ? "url(#portrait-accent)" : style.color,
    alt: name,
  });
  if (!portrait) {
    const monogram = initialsFrom(name);
    const monogramBlock = block(monogram, { size: portraitSize * 0.28, weight: 700, lineHeight: 1 }, portraitSize);
    put(
      monogramBlock,
      portraitX + portraitSize / 2,
      portraitY + (portraitSize - monogramBlock.height) / 2,
      "#ffffff",
      "P",
      true,
    );
  }
  const chipWidth = p.role.width + (square ? 36 : 28) * p.factor;
  const chipHeight = p.role.height + (square ? 20 : 16) * p.factor;
  const chipX = square ? (width - chipWidth) / 2 : 72;
  const chipY = square ? y + 360 + 18 - chipHeight : y;
  bar(chipX, chipY, chipWidth, chipHeight, style.color);
  put(p.role, chipX + (square ? 18 : 14) * p.factor, chipY + (square ? 10 : 8) * p.factor, style.ink);
  y += square ? 360 + p.gap + 28 * p.factor : chipHeight + p.gap;
  put(p.nameBlock, square ? width / 2 : 72, y, "#ffffff", "H1", square);
  y += p.nameBlock.height + p.gap;
  bar(square ? (width - 160) / 2 : 72, y, 160, 8, "url(#accent)");
  y += 8 + p.gap;
  if (p.affiliation.lines.length) {
    put(p.affiliation, square ? width / 2 : 72, y, "#ffffff", "P", square);
    y += p.affiliation.height + p.gap;
  }
  if (p.topicBlocks.length) {
    if (!square) {
      y += 6 * p.factor;
      bar(72, y, 6, p.topicHeight, style.color);
    }
    for (const b of p.topicBlocks) {
      put(b, square ? width / 2 : 94, y, square && b.s.mono ? style.color : "#ffffff", "P", square);
      y += b.height + 6 * p.factor;
    }
  }
  bar(0, bandTop, width, height - bandTop, style.color);
  const action =
    style.speaking && sessions.length
      ? sessions.length > 1
        ? "Join my sessions"
        : "Join my session"
      : style.label === "Organizer" || style.label === "Staff" || style.label === "Sponsor"
        ? "Join us"
        : "Join me";
  const link = data.registrationUrl.replace(/^https?:\/\//u, "");
  const ctaAction = block(action, { size: square ? 26 : 24, weight: 700 }, 500);
  let ctaLink = block(link, { size: 20, weight: 500, mono: true }, width);
  const arrowWidth = 26;
  let ctaWidth = square
    ? Math.max(ctaAction.width + arrowWidth, ctaLink.width) + 52
    : ctaAction.width + arrowWidth + 16 + ctaLink.width + 48;
  for (let size = 19; ctaWidth > (width - 144) * 0.6 && size >= 8; size--) {
    ctaLink = block(link, { size, weight: 500, mono: true }, width);
    ctaWidth = square
      ? Math.max(ctaAction.width + arrowWidth, ctaLink.width) + 52
      : ctaAction.width + arrowWidth + 16 + ctaLink.width + 48;
  }
  const ctaHeight = square
    ? ctaAction.height + 6 + ctaLink.height + 36
    : Math.max(ctaAction.height, ctaLink.height) + 32;
  const footerTop = bandTop + (square ? 28 : 20),
    footerHeight = height - bandTop - (square ? 88 : 80);
  const ctaX = width - 72 - ctaWidth,
    ctaY = footerTop + (footerHeight - ctaHeight) / 2;
  bar(ctaX, ctaY, ctaWidth, ctaHeight, "#0b0d0c");
  put(ctaAction, ctaX + (square ? 26 : 24), ctaY + (square ? 18 : (ctaHeight - ctaAction.height) / 2));
  put(
    ctaLink,
    square ? ctaX + 26 : ctaX + 24 + ctaAction.width + arrowWidth + 16,
    ctaY + (square ? 18 + ctaAction.height + 6 : (ctaHeight - ctaLink.height) / 2),
  );
  page.arrows = [
    {
      x: ctaX + (square ? 26 : 24) + ctaAction.width + 8,
      y: ctaY + (square ? 18 + ctaAction.height / 2 : ctaHeight / 2),
      length: 18,
      color: "#ffffff",
    },
  ];
  const footerWidth = ctaX - 104;
  let footerTitle = block(personal.eventName, { size: square ? 28 : 26, weight: 700, tracking: -0.01 }, footerWidth);
  let footerPlace = block(personal.location ?? "", { size: square ? 22 : 20, weight: 500 }, footerWidth);
  let footerGap = square ? 6 : 4;
  for (const factor of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25]) {
    if (footerTitle.height + footerPlace.height + footerGap <= footerHeight) break;
    footerTitle = block(
      personal.eventName,
      { size: (square ? 28 : 26) * factor, weight: 700, tracking: -0.01 },
      footerWidth,
    );
    footerPlace = block(personal.location ?? "", { size: (square ? 22 : 20) * factor, weight: 500 }, footerWidth);
    footerGap = (square ? 6 : 4) * factor;
  }
  const footerY = footerTop + (footerHeight - footerTitle.height - footerPlace.height - footerGap) / 2;
  put(footerTitle, 72, footerY, style.ink, "H2");
  put(footerPlace, 72, footerY + footerTitle.height + footerGap, style.ink);
  return page;
}
