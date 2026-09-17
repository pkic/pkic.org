/**
 * PictureTile — a record's picture as the whole affordance.
 *
 * The picture when there is one, the name's initials when there is not. For
 * someone who may change it, the tile itself is the control: hovering or
 * focusing it says "Change photo", activating it opens the file chooser, and
 * a small corner button removes it. No panel header, no button standing open
 * next to the picture.
 *
 * It was called `LogoTile` and served organizations only, while a person's
 * portrait was changed from a file input at the bottom of the record under
 * "Account administration" — which is what #28 objected to, holding up the
 * way every social network does it: you click the picture. The affordance was
 * already written; it was only ever named after one of the two things it is
 * for. Both now use it, and the noun and the shape are the caller's.
 */
import { useId, useRef, useState } from "preact/hooks";
import { AvatarStanding, type AvatarStatus } from "../ui/Avatar";
import { monogramFrom } from "../shared/initials";
import { useLogoCommands, type LogoManagerProps } from "./LogoManager";
import "./PictureTile.css";

export interface PictureTileProps extends Omit<LogoManagerProps, "hint" | "uploadLabel"> {
  /** The name whose initials stand in while there is no picture. */
  name: string;
  /** Standing surrounds the picture only, excluding editor actions. */
  status?: AvatarStatus;
  /** Whether the reader may change the picture. Read-only viewers get the tile alone. */
  canChange: boolean;
  /**
   * What this picture is called, in the words the control uses: "Change
   * photo", "Upload logo". A person has a photo and an organization has a
   * logo, and the control should say which rather than picking one.
   */
  noun?: string;
  /**
   * `round` is a person. A face in a square reads as a logo, and every other
   * surface in the portal already draws people round.
   */
  shape?: "square" | "round";
  /** What the file rule is, announced with the control. */
  hint?: string;
  /**
   * `mark` is the record-header size: a fixed square that holds its width in a
   * layout that sizes its columns to their contents.
   *
   * The default tile is `width: 100%` up to a cap, which is right in a panel
   * that gives it a column and wrong in a subject header, where the media
   * track is `auto` — with no intrinsic width the tile collapsed to its
   * padding and the logo disappeared.
   */
  size?: "default" | "mark";
}

export function PictureTile(props: PictureTileProps) {
  const hintId = useId();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPicture = Boolean(props.imageUrl && props.imageUrl !== failedUrl);
  const { busy, attempt, upload, remove } = useLogoCommands({ ...props, noun: props.noun });
  const inputRef = useRef<HTMLInputElement>(null);
  const noun = props.noun ?? "logo";
  const label = props.imageUrl ? `Change ${noun}` : `Upload ${noun}`;

  const picture = hasPicture ? (
    <img
      class={props.shape === "round" ? "portal-picture-tile-portrait" : "pk-picture-tile__img"}
      src={props.imageUrl ?? undefined}
      alt={props.alt}
      onError={() => setFailedUrl(props.imageUrl)}
    />
  ) : (
    <span class="pk-picture-tile__initials" aria-hidden="true">
      {monogramFrom(props.name)}
    </span>
  );

  const sizing =
    (props.size === "mark" ? " pk-picture-tile--mark" : "") +
    (props.shape === "round" ? " pk-picture-tile--round" : "");

  const withStanding = (picture: preact.ComponentChildren) =>
    props.status ? <AvatarStanding status={props.status}>{picture}</AvatarStanding> : picture;

  if (!props.canChange) {
    return withStanding(
      <div
        class={`pk pk-picture-tile${sizing}`}
        role="img"
        aria-label={hasPicture ? props.alt : `${props.name} has no ${noun}`}
      >
        {picture}
      </div>,
    );
  }

  return (
    <div class={`pk pk-picture-tile pk-picture-tile--editable${sizing}`}>
      {withStanding(
        <button
          type="button"
          class="pk-picture-tile__control"
          aria-label={label}
          aria-describedby={props.hint ? hintId : undefined}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {picture}
          <span class="pk-picture-tile__veil" aria-hidden="true">
            {busy ? "Uploading…" : label}
          </span>
        </button>,
      )}
      <input
        key={attempt}
        ref={inputRef}
        class="pk-picture-tile__input"
        type="file"
        accept={props.accept ?? "image/jpeg,image/png,image/webp"}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (file) void upload(file);
        }}
      />
      {/* The file rule is announced with the control, not drawn under the
          mark as a loose sentence: the veil already says what pressing does. */}
      {props.hint && (
        <span id={hintId} class="pk-sr-only">
          {props.hint}
        </span>
      )}
      {props.imageUrl && (
        <button
          type="button"
          class="pk-picture-tile__remove"
          aria-label={props.removeLabel}
          title={props.removeLabel}
          disabled={busy}
          onClick={() => void remove()}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
