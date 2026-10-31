import { layoutPersonalPromotion } from "./promotion-personal-scene";
import { promotionStillBlocks, type PromotionStillContent } from "./promotion-still";
import { layoutPromotionTakeaways, layoutPromotionDetails } from "./promotion-content-panels";
import { layoutPromotionSponsors } from "./promotion-sponsors";
import { plainText } from "../../../../assets/shared/markdown-plain-text";
import {
  formatClockInZone,
  formatTimeRangeInZone,
  formatDateRange,
  formatClockRangeInZone,
  formatClockName,
  formatDuration,
} from "../../../../assets/shared/format-date";
import {
  defaultPromotionComposition,
  type PromotionComposition,
} from "../../../../assets/shared/schemas/event-promotion-design";
import { creditAffiliationLabels } from "../../../../assets/shared/agenda-speaker-affiliations";
import { promotionMeasuredLines } from "./promotion-text";
import type { PromotionRenderData } from "./promotion-render";

export interface PromotionText {
  group?: string;
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  role: "H1" | "H2" | "P" | "LI";
  color?: string;
  anchor?: "middle" | "end";
  mono?: boolean;
  weight?: 400 | 500 | 600 | 700;
  letterSpacing?: number;
}
export interface PromotionPicture {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  circle?: boolean;
  ringColor?: string;
  ringWidth?: number;
  alt: string;
}
export interface PromotionPage {
  title: string;
  texts: PromotionText[];
  pictures: PromotionPicture[];
  index: number;
  total: number;
  width: number;
  height: number;
  light?: boolean;
  qr?: boolean;
  social?: { bandTop: number; focalPoint: { x: number; y: number } };
  bars?: { x: number; y: number; width: number; height: number; color: string; opacity?: number }[];
  sponsorBoard?: { x: number; y: number; width: number; height: number };
  markX?: number;
  rules?: { x: number; y: number; width: number }[];
  arrows?: { x: number; y: number; length: number; color: string }[];
}
export interface PromotionBlock {
  text: string;
  size: number;
  bold?: boolean;
  role?: PromotionText["role"];
  portrait?: { src: string; name: string };
  indent?: number;
}
/** A personal preview needs event and identity facts, not a fabricated session or agenda. */
export interface PersonalPromotionRenderData {
  personal: PromotionStillContent & {
    eventName: string;
    firstName?: string;
    dates?: string;
    location?: string;
    city?: string;
    sessions?: { title: string }[];
    roleStyle?: ReturnType<typeof import("../../../../assets/shared/badge-role-colors").personalPromotionRoleStyle>;
  };
  registrationUrl: string;
  design?: PromotionRenderData["design"];
  composition?: PromotionRenderData["composition"];
  audience?: PromotionRenderData["audience"];
  actorId?: string;
  portraits?: Record<string, string>;
  logoDataUrl?: string;
  heroImage?: import("../../utils/image-format").EmbeddedRasterImage | null;
  scene?: PromotionPage;
  measure?: PromotionMeasure;
}
export type PromotionMeasure = ((
  text: string,
  size: number,
  bold: boolean,
  mono?: boolean,
  weight?: number,
) => number) & {
  metrics?: (
    size: number,
    bold: boolean,
    mono?: boolean,
    weight?: number,
  ) => { ascent: number; descent: number; lineGap: number };
};
export const promotionDimensions = {
  landscape: [1200, 630],
  square: [1080, 1080],
  portrait: [1080, 1350],
  panel: [1200, 630],
  carousel: [1080, 1350],
} as const;
export type PromotionFormat = keyof typeof promotionDimensions;
export function promotionPeople(data: PromotionRenderData) {
  return (
    data.people ??
    (data.occurrence.history?.appearances.length ? data.occurrence.history.appearances : data.occurrence.speakers).map(
      (person) => ({
        userId: person.userId,
        displayName: person.displayName,
        affiliation: creditAffiliationLabels(person).join("; "),
        photoUrl: "photoUrl" in person && typeof person.photoUrl === "string" ? person.photoUrl : null,
        role: "role" in person && typeof person.role === "string" ? person.role : "speaker",
      }),
    )
  );
}
/** One measured layout drives the SVG and PDF adapters. Continuation never discards text or credits. */
export function buildPromotionPages(
  data: PromotionRenderData | PersonalPromotionRenderData,
  format: PromotionFormat,
  measure: PromotionMeasure = data.measure ?? ((text, size) => Array.from(text).length * size * 0.55),
): PromotionPage[] {
  const [width, height] = promotionDimensions[format];
  const scale = width / 1080,
    margin = 80 * scale,
    usable = width - margin * 2;
  const footer = height - (format === "landscape" || format === "panel" ? 95 : 210);
  const sponsorBottom = height < 800 ? height - (data.composition?.qrCode ? 180 : 130) : footer;
  const pages: PromotionPage[] = [];
  const composition: PromotionComposition =
    data.composition ?? defaultPromotionComposition(data.audience === "attendee");
  const selected = composition.panels;
  const add = (title: string, light = false) => {
    if (pages.length >= 128)
      throw new Error("Promotion material exceeds 128 pages. Select fewer panels or shorter reviewed copy.");
    const page: PromotionPage = { title, texts: [], pictures: [], index: pages.length, total: 0, width, height, light };
    pages.push(page);
    return page;
  };
  const put = (
    page: PromotionPage,
    text: string,
    y: number,
    size: number,
    bold = false,
    role: PromotionText["role"] = "P",
    x = margin,
  ) => page.texts.push({ text, x, y, size, bold, role });
  let blockSequence = 0;
  let reservedRight = 0;
  function flow(
    title: string,
    blocks: PromotionBlock[],
    start = 200 * scale,
    maxWidth = usable - reservedRight,
    coverHeaderTop?: number,
  ) {
    let page = add(title),
      y = start;
    const headerTop =
      coverHeaderTop ??
      (format === "carousel" && title === composition.callToAction && selected.indexOf("register") >= 2 ? 410 : 120);
    const header = promotionMeasuredLines(title.toUpperCase(), maxWidth, (line) => measure(line, 22 * scale, true));
    for (const [index, line] of header.entries())
      put(page, line, (headerTop + index * 28) * scale, 22 * scale, true, "H2");
    y = Math.max(y, (headerTop + 50 + header.length * 28) * scale);
    if (coverHeaderTop !== undefined)
      y = Math.max(y, (headerTop + (header.length - 1) * 28 + 24) * scale + (blocks[0]?.size ?? 0));
    let portraitBottom = 0;
    for (const block of blocks) {
      const group = `block-${blockSequence++}`;
      const indent = block.indent ?? (block.portrait ? 150 * scale : 0);
      if (block.portrait) {
        if (portraitBottom) y = Math.max(y, portraitBottom + block.size + 24 * scale);
        if (y - block.size + 127 * scale > footer) {
          page = add(title);
          put(page, title.toUpperCase(), 100 * scale, 22 * scale, true, "H2");
          y = 180 * scale;
        }
        portraitBottom = y - block.size + 120 * scale;
        page.pictures.push({
          src: block.portrait.src,
          x: margin,
          y: y - block.size,
          width: 120 * scale,
          height: 120 * scale,
          circle: true,
          alt: block.portrait.name,
        });
      }
      if (!block.portrait && indent === 0 && portraitBottom) y = Math.max(y, portraitBottom + block.size);
      const lines = promotionMeasuredLines(plainText(block.text), maxWidth - indent, (line) =>
        measure(line, block.size, Boolean(block.bold)),
      );
      for (const line of lines) {
        if (y + block.size * 1.25 > footer) {
          page = add(title);
          put(page, title.toUpperCase(), 100 * scale, 22 * scale, true, "H2");
          y = 180 * scale;
          portraitBottom = 0;
        }
        put(page, line, y, block.size, block.bold, block.role, margin + indent);
        page.texts.at(-1)!.group = group;
        y += block.size * 1.25;
      }
      y += 24 * scale;
    }
    return page;
  }
  if ("personal" in data) return [layoutPersonalPromotion(data, width, height, measure)];
  const people = promotionPeople(data);
  const clock = { timeZone: data.agenda.timeZone, city: data.agenda.clockCity ?? null };
  const time = data.occurrence.startAt
    ? formatTimeRangeInZone(data.occurrence.startAt, data.occurrence.endAt ?? undefined, clock)
    : "";
  const detailTime = data.occurrence.startAt
    ? formatClockRangeInZone(data.occurrence.startAt, data.occurrence.endAt ?? undefined, clock)
    : "";
  const duration =
    data.occurrence.startAt && data.occurrence.endAt
      ? formatDuration(Date.parse(data.occurrence.endAt) - Date.parse(data.occurrence.startAt))
      : "";
  const formatLabel =
    data.agenda.formats?.find((option) => option.id === data.occurrence.format)?.label ??
    data.occurrence.format ??
    data.occurrence.sourceProposalType;
  const dates = formatDateRange(data.occurrence.startAt, data.occurrence.endAt, data.agenda.timeZone);
  const location = data.agenda.rooms.find((room) => room.id === data.occurrence.roomId)?.name;
  const heading =
    data.audience === "attendee" ? `I’m attending ${data.agenda.eventName ?? "this event"}` : data.occurrence.title;
  if (format !== "carousel") {
    const credits =
      format === "panel"
        ? people
        : people.length > 1
          ? people
          : [people.find((person) => person.userId === data.actorId) ?? people[0]].filter(
              (person): person is NonNullable<typeof person> => Boolean(person),
            );
    const summary = selected.includes("content")
      ? composition.summary ||
        (composition.content === "abstract" ? data.occurrence.description : data.copy.whyAttend) ||
        data.occurrence.description
      : undefined;
    const blocks = promotionStillBlocks(
      {
        heading,
        people: selected.includes("speakers") || data.audience === "attendee" ? credits : [],
        summary,
        details: selected.includes("details")
          ? [dates, time, location, data.place, data.mediaWording].filter(Boolean).join(" · ")
          : undefined,
        picks: selected.includes("picks") ? data.picks : undefined,
        callToAction: composition.callToAction,
      },
      composition,
      scale,
      height,
      data.portraits,
    );
    flow(data.agenda.eventName ?? "PKI Consortium", blocks, 220 * scale);
  }
  for (const panel of format === "carousel" ? selected : selected.filter((panel) => panel === "sponsors")) {
    reservedRight =
      format === "carousel" &&
      selected[selected.indexOf(panel) + 1] === "sponsors" &&
      data.sponsors?.some((group) => group.sponsors.length)
        ? (composition.overlap === "bold" ? 220 : 90) * scale
        : 0;
    if (panel === "cover") {
      const size = (height < 800 ? 52 : 84) * scale;
      const page = flow(
        data.agenda.eventName ?? "PKI Consortium",
        [
          { text: heading, size, bold: true, role: "H1" },
          {
            text:
              data.audience === "attendee"
                ? (people[0]?.displayName ?? "")
                : people.length <= 2
                  ? `with ${people.map((p) => p.displayName).join(" & ")}`
                  : `${people.length} speakers`,
            size: 32 * scale,
            bold: true,
          },
          { text: [dates, time, location].filter(Boolean).join(" · "), size: 23 * scale },
        ],
        height < 800 ? 170 * scale : 420 * scale,
        Math.min(usable - reservedRight, 760 * scale),
        height < 800 ? 100 : 355,
      );
      const primary = people.find((p) => p.userId === data.actorId) ?? people[0];
      if (primary && height >= 1080) {
        const photo = data.portraits?.[primary.userId];
        if (photo)
          page.pictures.push({
            src: photo,
            x: width - 300 * scale - reservedRight,
            y: 50 * scale,
            width: 220 * scale,
            height: 220 * scale,
            circle: true,
            alt: primary.displayName,
          });
      }
    }
    if (panel === "speakers" && data.audience !== "attendee" && people.length) {
      if (people.length > 1) {
        flow(
          "Meet the speakers",
          people.flatMap((person) => [
            {
              text: person.displayName,
              size: 40 * scale,
              bold: true,
              role: "H2" as const,
              portrait: data.portraits?.[person.userId]
                ? { src: data.portraits[person.userId]!, name: person.displayName }
                : undefined,
            },
            {
              text: [person.role === "moderator" ? "Moderator" : null, person.affiliation].filter(Boolean).join(" · "),
              size: 27 * scale,
              indent: data.portraits?.[person.userId] ? 150 * scale : 0,
            },
          ]),
          selected[0] === "cover" && data.portraits?.[people[0]!.userId] ? 430 * scale : 210 * scale,
        );
      } else {
        const person = people[0]!,
          photo = data.portraits?.[person.userId];
        const page = flow(
          "Meet the speaker",
          [
            { text: person.displayName, size: 64 * scale, bold: true, role: "H2" },
            { text: person.affiliation, size: 32 * scale },
          ],
          photo && height >= 1080 ? 740 * scale : 240 * scale,
        );
        if (photo && height >= 1080)
          page.pictures.push({
            src: photo,
            x: margin,
            y: 150 * scale,
            width: 480 * scale,
            height: 480 * scale,
            circle: true,
            alt: person.displayName,
          });
      }
    }
    if (panel === "content" && data.audience !== "attendee") {
      const takeaways = composition.takeaways.length ? composition.takeaways : data.copy.takeaways;
      const useTake = composition.content !== "abstract" && takeaways.length > 0;
      const summary =
        composition.summary ||
        (composition.content === "abstract" ? data.occurrence.description : data.copy.whyAttend) ||
        data.occurrence.description;
      if (useTake) layoutPromotionTakeaways(takeaways, add, measure, scale, reservedRight);
      else if (summary) flow("About this session", [{ text: summary, size: 38 * scale }]);
    }
    if (panel === "details" && data.audience !== "attendee")
      layoutPromotionDetails(
        [
          ...(dates ? [{ label: "Day", value: dates }] : []),
          ...(detailTime
            ? [
                {
                  label: "Time",
                  value: detailTime,
                  sub: [formatClockName(clock), duration].filter(Boolean).join(" · "),
                },
              ]
            : []),
          ...(location || data.place
            ? [
                {
                  label: "Room",
                  value: location ?? data.place!,
                  ...(location && data.place ? { sub: data.place } : {}),
                },
              ]
            : []),
          ...(formatLabel || data.mediaWording
            ? [
                {
                  label: "Format",
                  value: formatLabel ?? "Session",
                  ...(data.mediaWording ? { sub: data.mediaWording } : {}),
                },
              ]
            : []),
        ],
        add,
        measure,
        scale,
        reservedRight,
      );
    if (panel === "picks" && data.picks?.length)
      flow(
        "On my agenda",
        data.picks.flatMap((pick) => [
          { text: pick.title, size: 36 * scale, bold: true },
          {
            text: [
              formatDateRange(pick.startAt, pick.endAt, data.agenda.timeZone),
              pick.startAt ? formatClockInZone(pick.startAt, clock) : "",
            ]
              .filter(Boolean)
              .join(" · "),
            size: 23 * scale,
          },
        ]),
      );
    if (panel === "register") {
      const page = flow(composition.callToAction, [
        { text: data.agenda.eventName ?? "", size: 64 * scale, bold: true, role: "H2" },
        { text: [data.place, dates].filter(Boolean).join(" · "), size: 32 * scale },
        { text: data.registrationUrl, size: 24 * scale },
      ]);
      page.qr = composition.qrCode;
    }
    if (panel === "sponsors" && data.sponsors?.some((group) => group.sponsors.length)) {
      layoutPromotionSponsors(data.sponsors, add, put, scale, sponsorBottom);
    }
  }

  if (!pages.length) flow("Promotion materials", [{ text: heading, size: 48 * scale, bold: true, role: "H1" }]);
  for (const page of pages) {
    page.total = pages.length;
    page.qr = composition.qrCode;
  }
  for (const page of pages) {
    if (!page.light) continue;
    const overlap = format === "carousel" && page.index > 0 ? (composition.overlap === "bold" ? 220 : 90) * scale : 0;
    const board = {
      y: (height < 800 ? 40 : 150) * scale,
      height: sponsorBottom - (height < 800 ? 40 : 150) * scale,
      width: width + overlap,
    };
    page.sponsorBoard = { ...board, x: -overlap };
    const previous = pages[page.index - 1];
    if (overlap && previous && !previous.light) previous.sponsorBoard = { ...board, x: width - overlap };
  }
  // Artwork occupies one panorama coordinate system, clipped by each exported page.
  const registerIndex = pages.findIndex((page) => page.title === composition.callToAction);
  if (format === "carousel" && registerIndex >= 2 && !pages[registerIndex - 1]!.light) {
    const x = (composition.overlap === "bold" ? 800 : 940) * scale;
    pages[registerIndex - 1]!.markX = x;
    pages[registerIndex]!.markX = x - width;
  }
  const first = pages[0],
    next = pages[1],
    primary = people.find((person) => person.userId === data.actorId) ?? people[0];
  const photo = primary ? data.portraits?.[primary.userId] : undefined;
  if (format === "carousel" && selected[0] === "cover" && selected[1] === "speakers" && first && next && photo) {
    const size = (people.length > 1 ? 280 : 560) * scale,
      overlap = (composition.overlap === "bold" ? 280 : 140) * scale;
    first.pictures = first.pictures.filter((picture) => picture.alt !== primary!.displayName);
    next.pictures = next.pictures.filter((picture) => picture.alt !== primary!.displayName);
    first.pictures.push({
      src: photo,
      x: width - overlap,
      y: 60 * scale,
      width: size,
      height: size,
      circle: true,
      alt: primary!.displayName,
    });
    for (const text of next.texts) if (text.y === 120 * scale) text.x = Math.max(margin, size - overlap + 40 * scale);
    next.pictures.push({
      src: photo,
      x: -overlap,
      y: 60 * scale,
      width: size,
      height: size,
      circle: true,
      alt: primary!.displayName,
    });
  }
  return pages;
}
