import type { ComponentChildren, JSX } from "preact";
import { ButtonLink, type ButtonVariant } from "../ui/Button";
import { ContentIcon } from "./ContentIcon";
import { SupportBanner } from "./SupportBanner";
import "./ContentComponents.css";
import "./ContentGrid.scss";

export type ContentFrameKind = "cards" | "columns" | "criteria" | "donation" | "generic" | "sidebar" | "sub";

export function ContentFrame({
  children,
  kind = "generic",
}: {
  children?: ComponentChildren;
  kind?: ContentFrameKind;
}) {
  const Element = kind === "sub" ? "sub" : kind === "sidebar" ? "aside" : "div";
  return <Element class={`pk-content-component pk-content-component--${kind}`}>{children}</Element>;
}

export function ContentHtml({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Preserve the authored responsive grid without an extra child wrapper. */
export function ContentRow({ html }: { html: string }) {
  return <div class="content-row" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ContentColumn({ html, options }: { html: string; options: Record<string, string> }) {
  const classes = ["content-col"];
  for (const [option, breakpoint] of [
    ["sm", "sm"],
    ["md", "md"],
    ["size", "lg"],
  ] as const) {
    const span = Number(options[option]);
    if (Number.isInteger(span) && span >= 1 && span <= 12) classes.push(`content-col--${breakpoint}-${span}`);
  }
  if (options.sticky === "true") classes.push("content-col--sticky");
  if (options.class) classes.push(options.class);
  return <div class={classes.join(" ")} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * An authored alert, drawn as the design system's own alert.
 *
 * The tone maps onto `--pk-ok`, `--pk-info`, `--pk-warn` and `--pk-danger`
 * rather than a colour pair picked here, and the destructive tones announce
 * themselves while the rest report — which is what `ui/Alert.tsx` does, and
 * what the published `alert` shortcode wrote.
 */
const ALERT_TONES: Record<string, { icon: string; tone: string }> = {
  danger: { icon: "✗", tone: "danger" },
  info: { icon: "ℹ", tone: "info" },
  success: { icon: "✓", tone: "ok" },
  warning: { icon: "⚠", tone: "warn" },
};

export function ContentAlert({ html, tone = "success" }: { html: string; tone?: string }) {
  const { icon, tone: toneClass } = ALERT_TONES[tone] ?? ALERT_TONES.success!;
  return (
    <div class="pk pk-container">
      <div
        class={`pk-content-alert pk-alert pk-alert--${toneClass}`}
        role={toneClass === "warn" || toneClass === "danger" ? "alert" : "status"}
      >
        <span aria-hidden="true">{icon}</span>
        <div class="pk-alert__body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

function safeHref(value?: string): string {
  if (!value) return "#";
  return /^javascript:/i.test(value.trim()) ? "#" : value;
}

export function ContentButtonLink({
  href,
  label,
  target,
  variant = "primary",
}: {
  href?: string;
  label?: string;
  target?: string;
  variant?: ButtonVariant;
}) {
  const external = target === "_blank" || /^https?:\/\//i.test(href ?? "");
  return (
    <ButtonLink
      href={safeHref(href)}
      target={target}
      rel={external ? "noopener external" : undefined}
      variant={variant}
    >
      {label ?? href ?? "Continue"}
    </ButtonLink>
  );
}

export function ContentFigure({
  alt,
  caption,
  className,
  height,
  href,
  src,
  width,
}: {
  alt?: string;
  caption?: string;
  className?: string;
  height?: string;
  href?: string;
  src: string;
  width?: string;
}) {
  const numericWidth = width && /^\d+$/.test(width) ? Number(width) : undefined;
  const numericHeight = height && /^\d+$/.test(height) ? Number(height) : undefined;
  const image = (
    <img src={safeHref(src)} alt={alt ?? caption ?? ""} width={numericWidth} height={numericHeight} loading="lazy" />
  );
  return (
    <figure class={["pk-content-figure", className].filter(Boolean).join(" ")}>
      {href ? <a href={safeHref(href)}>{image}</a> : image}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function ContentVideo({ id, title }: { id?: string; title?: string }) {
  if (!id || !/^[\w-]+$/.test(id)) return null;
  return (
    <div class="pk-content-video">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title={title ?? "Video"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

export function ContentGallery({ images }: { images: string[] }) {
  if (!images.length) return null;
  return (
    <div class="pk-content-gallery" role="group" aria-label="Photos">
      {images.map((src) => {
        const filename = decodeURIComponent(src.split("/").at(-1) ?? "Photo");
        const alt = filename.replace(/\.[^.]+$/, "").replaceAll(/[-_]+/g, " ");
        return <img src={safeHref(src)} alt={alt} loading="lazy" key={src} />;
      })}
    </div>
  );
}

export interface ContentCardData {
  color?: string;
  icon?: string;
  image?: string;
  links?: Array<{ text?: string; url?: string; variant?: ButtonVariant }>;
  textHtml?: string;
  title?: string;
}

export function ContentCards({ cards, style }: { cards: ContentCardData[]; style?: string }) {
  // Authored bento cards use the same responsive card row as current Hugo.
  const bento = style === "bento";
  return (
    <section class={bento ? "pk-grid pk-grid--cards pkic-card-bento" : "pk-content-cards"}>
      {cards.map((card, index) => (
        <article
          class={bento ? `bento-card ${card.color ?? ""}`.trim() : "pk-content-card"}
          key={`${card.title ?? "card"}-${index}`}
        >
          {card.image ? (
            <div class={bento ? "bento-hero-image-wrapper" : undefined}>
              <img class={bento ? "bento-hero-image" : undefined} src={safeHref(card.image)} alt="" loading="lazy" />
            </div>
          ) : null}
          {bento && card.icon ? <ContentIcon name={card.icon} /> : null}
          <div class={bento ? "pk-stack" : "pk-content-card__body"}>
            {card.title ? <h3 class={bento ? "bento-title" : undefined}>{card.title}</h3> : null}
            {card.textHtml ? (
              <div class={bento ? "bento-text" : undefined} dangerouslySetInnerHTML={{ __html: card.textHtml }} />
            ) : null}
            {card.links?.length ? (
              <div class="pk-content-actions">
                {card.links.map((link, linkIndex) => (
                  <ContentButtonLink
                    href={link.url}
                    label={link.text}
                    variant={link.variant}
                    key={`${link.url ?? "link"}-${linkIndex}`}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

export function ContentStats({ stats }: { stats: Array<{ label?: string; number?: string }> }) {
  return (
    <dl class="stat-grid">
      {stats.map((stat, index) => (
        <div class="stat-grid-item" key={`${stat.label ?? "stat"}-${index}`}>
          <dt class="stat-grid-label">{stat.label}</dt>
          <dd class="stat-grid-number">{stat.number}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ContentBanner({
  body,
  heading,
  links,
  stat,
  statLabel,
  style,
}: {
  body?: string;
  heading?: string;
  links?: Array<{ primary?: boolean; text?: string; url?: string }>;
  stat?: string;
  statLabel?: string;
  style?: string;
}) {
  if (style !== "join") {
    return (
      <SupportBanner body={body} heading={heading} links={links} stat={stat} statLabel={statLabel} variant={style} />
    );
  }

  /*
   * The join call to action.
   *
   * `pk-on-solid` is what makes the buttons legible: the band paints its own
   * gradient, so a quiet button takes its surface from the ground it covers
   * rather than from the page's, and the primary one becomes the solid white.
   * Both are large, because this is the page's one call to action and not a
   * control in a toolbar.
   */
  return (
    <section class="pk pkic-join-cta pk-on-solid">
      <div class="pk-container pk-stack pk-center">
        {heading ? <h2>{heading}</h2> : null}
        {body ? <p class="pkic-join-cta-body" dangerouslySetInnerHTML={{ __html: body }} /> : null}
        {links?.length ? (
          <div class="pk-cluster pk-cluster--center">
            {links.map((link) => (
              <ButtonLink
                href={link.url ?? "#"}
                key={link.url ?? link.text}
                size="lg"
                variant={link.primary ? "primary" : "secondary"}
              >
                {link.text}
              </ButtonLink>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ContentFaq({
  groups,
}: {
  groups: Array<{ questions?: Array<{ answerHtml?: string; open?: boolean; question?: string }>; title?: string }>;
}) {
  return (
    <div class="pk-content-faq">
      {groups.map((group, groupIndex) => (
        <section key={`${group.title ?? "group"}-${groupIndex}`}>
          {group.title ? <h2>{group.title}</h2> : null}
          {group.questions?.map((item, itemIndex) => (
            <details open={item.open} key={`${item.question ?? "question"}-${itemIndex}`}>
              <summary>{item.question}</summary>
              {item.answerHtml ? <div dangerouslySetInnerHTML={{ __html: item.answerHtml }} /> : null}
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

export function ContentGlossary({ terms }: { terms: Array<{ definitionHtml?: string; term: string }> }) {
  return (
    <dl class="pk-content-glossary">
      {terms.map((item) => (
        <div key={item.term}>
          <dt id={item.term.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>{item.term}</dt>
          <dd dangerouslySetInnerHTML={{ __html: item.definitionHtml ?? "" }} />
        </div>
      ))}
    </dl>
  );
}

/**
 * The maturity model's staircase, as `maturity-staircase.html` draws it.
 *
 * Each step is a bar whose tint the level names, the phrase under it, and a
 * link into the level's own page. It is a list for assistive technology and a
 * rising staircase for everyone else, which is why the roles are written out
 * rather than left to an `ol`.
 */
export function ContentMaturity({
  levels,
}: {
  levels: Array<{ color?: string; label?: string; number?: number | string; summary?: string; url?: string }>;
}) {
  return (
    <div class="maturity-staircase" role="list" aria-label="Maturity model levels">
      {levels.map((level, index) => {
        const label = `Level ${level.number}: ${level.label}`;
        const bar = (
          <>
            <span class="maturity-step-number" aria-hidden="true">
              {level.number}
            </span>
            <span class="maturity-step-name">{level.label}</span>
          </>
        );
        return (
          <div
            class={`maturity-step maturity-step--${level.color ?? "gray"}`}
            role="listitem"
            key={`${level.number ?? index}-${level.label ?? "level"}`}
          >
            {level.url ? (
              <a href={safeHref(level.url)} class="maturity-step-bar" aria-label={label}>
                {bar}
              </a>
            ) : (
              <div class="maturity-step-bar" aria-label={label}>
                {bar}
              </div>
            )}
            {level.summary ? <p class="maturity-step-summary">{level.summary}</p> : null}
            {level.url ? (
              <a href={safeHref(level.url)} class="maturity-step-cta" aria-label={`Details for level ${level.number}`}>
                Details →
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ContentIsland({
  attributes,
  label,
  module,
}: {
  attributes?: Record<string, string>;
  label: string;
  module?: string;
}) {
  const islandAttributes = Object.fromEntries(
    Object.entries(attributes ?? {}).map(([key, value]) => [`data-${key}`, value]),
  ) as JSX.HTMLAttributes<HTMLDivElement>;
  return (
    <div class="pk-content-island" data-content-component={label} data-module={module} {...islandAttributes}>
      {/*
        A placeholder, not content: the loader removes it before the module
        mounts. Without that, an island that resolves to nothing — a widget
        whose roster is empty, say — left "Loading…" on the page for good.
      */}
      <p class="pk-muted pk-island-placeholder">Loading {label}…</p>
    </div>
  );
}

/**
 * The member and sponsor logo wall's frame.
 *
 * The published site wrapped the island in its own section so the wall has a
 * ground, an inset and a caption, and so the caption disappears with the band
 * when there is nothing to show. The island only renders the logos.
 */
export function ContentMemberWall({
  children,
  className,
  title,
}: {
  children: ComponentChildren;
  className?: string;
  title?: string;
}) {
  return (
    <>
      {title ? (
        <div class="pkic-section-label">
          <span>{title}</span>
        </div>
      ) : null}
      <section class={`members-overview${className ? ` ${className}` : ""}`}>
        <div class="members pk-center">{children}</div>
      </section>
    </>
  );
}
