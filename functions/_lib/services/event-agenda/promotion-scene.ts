import { plainText } from "../../../../assets/shared/markdown-plain-text";
import { formatClockInZone, formatTimeRangeInZone, formatDateRange } from "../../../../assets/shared/format-date";
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
}
export interface PromotionPicture {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  circle?: boolean;
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
}
interface PromotionBlock {
  text: string;
  size: number;
  bold?: boolean;
  role?: PromotionText["role"];
  portrait?: { src: string; name: string };
  indent?: number;
}
export type PromotionMeasure = (text: string, size: number, bold: boolean) => number;
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
  data: PromotionRenderData,
  format: PromotionFormat,
  measure: PromotionMeasure = data.measure ?? ((text, size) => Array.from(text).length * size * 0.55),
): PromotionPage[] {
  const [width, height] = promotionDimensions[format];
  const scale = width / 1080,
    margin = 80 * scale,
    usable = width - margin * 2;
  const footer = height - (format === "landscape" || format === "panel" ? 95 : 210);
  const pages: PromotionPage[] = [];
  const people = promotionPeople(data);
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
  function flow(title: string, blocks: PromotionBlock[], start = 200 * scale, maxWidth = usable) {
    let page = add(title),
      y = start;
    const header = promotionMeasuredLines(title.toUpperCase(), usable, (line) => measure(line, 22 * scale, true));
    for (const [index, line] of header.entries()) put(page, line, (120 + index * 28) * scale, 22 * scale, true, "H2");
    y = Math.max(y, (170 + header.length * 28) * scale);
    for (const block of blocks) {
      const group = `block-${blockSequence++}`;
      const indent = block.indent ?? (block.portrait ? 150 * scale : 0);
      if (block.portrait) {
        if (y + 170 * scale > footer) {
          page = add(title);
          put(page, title.toUpperCase(), 100 * scale, 22 * scale, true, "H2");
          y = 180 * scale;
        }
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
      const lines = promotionMeasuredLines(plainText(block.text), maxWidth - indent, (line) =>
        measure(line, block.size, Boolean(block.bold)),
      );
      for (const line of lines) {
        if (y + block.size * 1.25 > footer) {
          page = add(title);
          put(page, title.toUpperCase(), 100 * scale, 22 * scale, true, "H2");
          y = 180 * scale;
        }
        put(page, line, y, block.size, block.bold, block.role, margin + indent);
        page.texts.at(-1)!.group = group;
        y += block.size * 1.25;
      }
      y += 24 * scale;
    }
    return page;
  }
  const clock = { timeZone: data.agenda.timeZone, city: data.agenda.clockCity ?? null };
  const time = data.occurrence.startAt
    ? formatTimeRangeInZone(data.occurrence.startAt, data.occurrence.endAt ?? undefined, clock)
    : "";
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
    const blocks: PromotionBlock[] = [
      {
        text: heading,
        size: (height < 800 ? 48 : composition.stillLayout === "expanded" ? 76 : 68) * scale,
        bold: true,
        role: "H1",
      },
    ];
    if (selected.includes("speakers") || data.audience === "attendee")
      for (const person of credits)
        blocks.push(
          {
            text: person.displayName,
            size: 32 * scale,
            bold: true,
            portrait: data.portraits?.[person.userId]
              ? { src: data.portraits[person.userId]!, name: person.displayName }
              : undefined,
          },
          { text: person.affiliation, size: 24 * scale, indent: data.portraits?.[person.userId] ? 150 * scale : 0 },
        );
    if (selected.includes("content")) {
      const summary =
        composition.summary ||
        (composition.content === "abstract" ? data.occurrence.description : data.copy.whyAttend) ||
        data.occurrence.description;
      blocks.push({ text: summary, size: 28 * scale });
    }
    if (selected.includes("details"))
      blocks.push({
        text: [dates, time, location, data.place, data.mediaWording].filter(Boolean).join(" · "),
        size: 23 * scale,
      });
    if (selected.includes("picks"))
      for (const pick of data.picks ?? []) blocks.push({ text: pick.title, size: 30 * scale, bold: true });
    blocks.push({ text: composition.callToAction, size: 30 * scale, bold: true });
    flow(data.agenda.eventName ?? "PKI Consortium", blocks, 220 * scale);
  }
  for (const panel of format === "carousel" ? selected : selected.filter((panel) => panel === "sponsors")) {
    if (panel === "cover") {
      const size = (height < 800 ? 52 : 84) * scale;
      const before = pages.length;
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
        Math.min(usable, 760 * scale),
      );
      if (pages[before]?.texts[0]) pages[before].texts[0].y = height < 800 ? 140 * scale : 355 * scale;
      const primary = people.find((p) => p.userId === data.actorId) ?? people[0];
      if (primary && height >= 1080) {
        const photo = data.portraits?.[primary.userId];
        if (photo)
          page.pictures.push({
            src: photo,
            x: width - 300 * scale,
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
      if (useTake)
        flow(
          "Key takeaways",
          takeaways.map((text, index) => ({
            text: `${String(index + 1).padStart(2, "0")}  ${text}`,
            size: 36 * scale,
            role: "LI",
          })),
        );
      else if (summary) flow("About this session", [{ text: summary, size: 38 * scale }]);
    }
    if (panel === "details" && data.audience !== "attendee")
      flow(
        "When & where",
        [dates, time, location, data.place, data.mediaWording]
          .filter((text): text is string => Boolean(text))
          .map((text) => ({ text, size: 36 * scale })),
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
      page.qr = true;
    }
    if (panel === "sponsors" && data.sponsors?.some((group) => group.sponsors.length)) {
      let page = add("Our sponsors", true),
        y = 200 * scale;
      put(page, "Our sponsors", 120 * scale, 48 * scale, true, "H2");
      for (const group of data.sponsors) {
        if (!group.sponsors.length) continue;
        const columns = Math.min(5, group.sponsors.length),
          cell = usable / columns;
        for (let offset = 0; offset < group.sponsors.length; offset += columns) {
          if (y + 140 * scale > footer) {
            page = add("Our sponsors", true);
            put(page, "Our sponsors", 120 * scale, 48 * scale, true, "H2");
            y = 200 * scale;
          }
          if (offset === 0 || y === 200 * scale) {
            put(page, group.label ?? group.tierName, y, 22 * scale, true, "H2");
            y += 35 * scale;
          }
          for (const [index, sponsor] of group.sponsors.slice(offset, offset + columns).entries())
            page.pictures.push({
              src: `data:image/svg+xml;base64,${sponsor.base64}`,
              x: margin + index * cell,
              y,
              width: cell - 24 * scale,
              height: 65 * scale,
              alt: sponsor.name,
            });
          y += 95 * scale;
        }
        y += 20 * scale;
      }
    }
  }

  if (!pages.length) flow("Promotion materials", [{ text: heading, size: 48 * scale, bold: true, role: "H1" }]);
  for (const page of pages) {
    page.total = pages.length;
    page.qr = true;
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
