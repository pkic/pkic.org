import type { ComponentChildren, JSX } from "preact";
import { Avatar } from "./Avatar";
import "../../design/tokens.agenda.generated.css";
import "./SpeakerPortraitCard.css";

/**
 * The agenda directory portrait surface, shared by readable and editable speaker rosters.
 *
 * A reader sees initials where no photo is on file. An organizer's roster
 * passes `missingImage` instead: there the empty photo is a gap to fill, so
 * the picture's own place says so ("No headshot") and holds the way to fill
 * it, rather than a large monogram that looks finished.
 */
export function SpeakerPortraitCard({
  name,
  imageSrc,
  missingImage,
  children,
  footer,
  buttonProps,
  actions,
  size = "full",
  footerControls,
  label,
}: {
  name: string;
  /** Names the card; "Speaker" and the name unless the person is someone else here. */
  label?: string;
  size?: "full" | "compact";
  imageSrc?: string | null;
  /** Shown in the photo's place when there is no photo; the monogram otherwise. */
  missingImage?: ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** Interactive footer controls are siblings of the portrait button, never its children. */
  footerControls?: ComponentChildren;
  actions?: ComponentChildren;
  buttonProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { [key: `data-${string}`]: string | boolean | undefined };
}) {
  const content = (
    <>
      {!imageSrc && missingImage ? (
        <div class="pk-speaker-portrait-missing">{missingImage}</div>
      ) : (
        <Avatar name={name} src={imageSrc ?? undefined} size="xl" original sizes="auto, 20rem" />
      )}
      <div class="pk-agenda-speaker-directory__caption">
        {children}
        {footer && <span class="pk-agenda-speaker-directory__footer">{footer}</span>}
      </div>
    </>
  );
  const card = buttonProps ? (
    <button {...buttonProps} type="button" data-size={size} class="pk-agenda-speaker-directory__card">
      {content}
    </button>
  ) : (
    <article data-size={size} class="pk-agenda-speaker-directory__card" aria-label={label ?? `Speaker ${name}`}>
      {actions && <div class="pk-speaker-portrait-actions">{actions}</div>}
      {content}
    </article>
  );
  return footerControls ? (
    <div class="pk-speaker-portrait-control-card">
      {card}
      <div class="pk-speaker-portrait-controls">{footerControls}</div>
    </div>
  ) : (
    card
  );
}
