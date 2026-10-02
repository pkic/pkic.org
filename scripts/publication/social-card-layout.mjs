const box = (style, ...children) => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const text = (value, style, id) => ({
  type: "div",
  props: { id, style: { display: "block", ...style }, children: value },
});
const image = (src, style) => ({ type: "img", props: { src, style } });
const COLORS = {
  purple: "#7142b9",
  "working-groups": "#7142b9",
  orange: "#bd642d",
  events: "#bd642d",
  blue: "#2878b7",
  blog: "#2878b7",
  teal: "#147b82",
  resources: "#147b82",
};
const rainbow = "linear-gradient(90deg, #198754, #20c997, #0d6efd, #ffc107, #fd7e14, #dc3545)";

/** A fixed social canvas with a generous crop-safe text area and distinct public variants. */
export function socialCardLayout(card, assets, fontSize = 60, titleBottom = 350, titleLines, titleTop = 112) {
  const accent = COLORS[card.accent] ?? "#198754";
  const people = card.kind === "working-group" ? card.leaders : [];
  const visual = assets.visual;
  const panel = Boolean(visual || people.length || (card.kind === "community" && assets.logos.length));
  const width = panel ? 692 : 1068;
  const name = (person) =>
    person.name
      .split(/\s+/)
      .map((part) => Array.from(part)[0])
      .slice(0, 2)
      .join("");
  const portrait = (person, size) =>
    person.photo
      ? image(person.photo, { width: size, height: size, borderRadius: size / 2, objectFit: "cover" })
      : box(
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: accent,
            alignItems: "center",
            justifyContent: "center",
            fontSize: size / 3,
            fontWeight: 700,
          },
          name(person),
        );
  return box(
    {
      width: 1200,
      height: 630,
      position: "relative",
      overflow: "hidden",
      fontFamily: "Roboto",
      color: "#fff",
      backgroundColor: "#081a1c",
      backgroundImage: `linear-gradient(125deg, #061719 8%, ${accent} 165%)`,
    },
    ...(assets.hero
      ? [
          image(assets.hero, { position: "absolute", width: 1200, height: 550, objectFit: "cover", opacity: 0.45 }),
          box({
            position: "absolute",
            width: 1200,
            height: 550,
            backgroundImage: "linear-gradient(90deg, rgba(4,16,20,0.95), rgba(4,16,20,0.50))",
          }),
        ]
      : []),
    box({ position: "absolute", left: 0, top: 0, width: 1200, height: 7, backgroundImage: rainbow }),
    box(
      { position: "absolute", left: 64, top: titleTop - 52, alignItems: "center", gap: 12 },
      box({ width: 8, height: 8, borderRadius: 4, backgroundColor: "#8de0b4" }),
      text(card.label.toUpperCase(), {
        fontSize: 17,
        fontWeight: 700,
        letterSpacing: 2,
        color: "#c5e6dd",
        maxWidth: 1000,
      }),
    ),
    text(
      card.title,
      {
        position: "absolute",
        left: 64,
        top: titleTop,
        width,
        fontSize,
        fontWeight: 700,
        lineHeight: 1.12,
        letterSpacing: -1.3,
        ...(titleLines ? { lineClamp: titleLines, textOverflow: "ellipsis", overflow: "hidden" } : {}),
      },
      "card-title",
    ),
    text(card.description, {
      position: "absolute",
      left: 64,
      top: titleBottom + 24,
      width,
      fontSize: 24,
      lineHeight: 1.38,
      color: "#c7d7d7",
      lineClamp: 2,
      overflow: "hidden",
    }),
    ...(card.authors.length
      ? [
          box(
            { position: "absolute", left: 64, top: 468, alignItems: "center", gap: 12 },
            ...assets.authors.slice(0, 3).map((author) => portrait(author, 36)),
            text(card.authors.map((author) => author.name).join(" · "), {
              fontSize: 18,
              color: "#d8e5e5",
              maxWidth: width - 160,
              lineClamp: 1,
              overflow: "hidden",
            }),
          ),
        ]
      : card.date
        ? [text(card.date, { position: "absolute", left: 64, top: 478, fontSize: 18, color: "#c7d7d7" })]
        : []),
    ...(visual
      ? [
          box(
            {
              position: "absolute",
              left: 820,
              top: 155,
              width: 316,
              height: 276,
              backgroundColor: card.visualRound ? "transparent" : assets.visualDark ? "#102b31" : "#fff",
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
              border: card.visualRound ? "none" : "1px solid rgba(255,255,255,0.3)",
            },
            image(visual, {
              width: card.visualRound ? 256 : 268,
              height: card.visualRound ? 256 : 220,
              borderRadius: card.visualRound ? 128 : 0,
              objectFit: card.visualRound ? "cover" : "contain",
            }),
          ),
        ]
      : []),
    ...(!visual && people.length
      ? [
          box(
            { position: "absolute", left: 820, top: 136, width: 316, flexDirection: "column", gap: 18 },
            ...assets.leaders.map((person) =>
              box(
                {
                  padding: 22,
                  backgroundColor: "rgba(255,255,255,0.09)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 20,
                  gap: 16,
                  alignItems: "center",
                },
                portrait(person, 64),
                box(
                  { flexDirection: "column", flex: 1, gap: 6 },
                  text(person.title, { fontSize: 13, color: "#9de1c1", textTransform: "uppercase", letterSpacing: 1 }),
                  text(person.name, { fontSize: 20, fontWeight: 700, lineHeight: 1.2, lineClamp: 2 }),
                  ...(person.organization
                    ? [text(person.organization, { fontSize: 14, color: "#c7d7d7", lineClamp: 1 })]
                    : []),
                ),
              ),
            ),
          ),
        ]
      : []),
    ...(!visual && !people.length && card.kind === "community"
      ? [
          box(
            { position: "absolute", left: 820, top: 130, width: 316, flexWrap: "wrap", gap: 14 },
            ...assets.logos.map((logo) =>
              box(
                {
                  width: 151,
                  height: 74,
                  backgroundColor: logo.dark ? "#102b31" : "#fff",
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                },
                image(logo.src, { width: 121, height: 44, objectFit: "contain" }),
              ),
            ),
          ),
        ]
      : []),
    box(
      {
        position: "absolute",
        left: 0,
        top: 550,
        width: 1200,
        height: 80,
        backgroundColor: "#061014",
        borderTop: "1px solid rgba(255,255,255,0.12)",
        alignItems: "center",
        padding: "0 64px",
        gap: 22,
      },
      image(assets.brand, { width: 190, height: 46, objectFit: "contain" }),
      text("pkic.org", { fontSize: 18, color: "#afc7c7", marginLeft: 14 }),
      ...(assets.sponsors.length
        ? [
            box(
              { marginLeft: "auto", alignItems: "center", gap: 12 },
              ...assets.sponsors.map((logo) =>
                box(
                  {
                    width: 100,
                    height: 38,
                    backgroundColor: logo.dark ? "#102b31" : "#fff",
                    borderRadius: 7,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  image(logo.src, { width: 82, height: 26, objectFit: "contain" }),
                ),
              ),
            ),
          ]
        : []),
    ),
    box({ position: "absolute", left: 0, top: 626, width: 1200, height: 4, backgroundImage: rainbow }),
  );
}
