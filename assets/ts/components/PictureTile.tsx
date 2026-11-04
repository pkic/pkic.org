/**
 * PictureTile — a record's picture as the whole affordance.
 *
 * The picture when there is one, the name's initials when there is not. For
 * someone who may change it, the tile itself is the control: hovering or
 * focusing it says "Change photo", a pencil in its corner says so at rest for
 * touch, activating it opens the file chooser, and a small corner button
 * removes it. No panel header, no button standing open
 * next to the picture.
 *
 * It was called `LogoTile` and served organizations only, while a person's
 * portrait was changed from a file input at the bottom of the record under
 * "Account administration" — which is what #28 objected to, holding up the
 * way every social network does it: you click the picture. The affordance was
 * already written; it was only ever named after one of the two things it is
 * for. Both now use it, and the noun and the shape are the caller's.
 */
import type { JSX } from "preact";
import type { FieldControlProps } from "../ui/Field";
import { useId, useRef } from "preact/hooks";
import { Avatar, AvatarStanding, type AvatarStatus } from "../ui/Avatar";
import { IconPencil } from "../ui/MediaIcons";
import { usePictureCommands, type PictureCommandOptions } from "./usePictureCommands";
import "./PictureTile.css";

interface PictureTileAppearance {
  /**
   * Whose picture this is. Its initials stand in while there is no picture,
   * and the controls carry it so a page holding several tiles still says
   * which one a button changes.
   */
  name: string;
  imageUrl: string | null;
  alt: string;
  /** Accepted upload types; callers with an SVG-only policy narrow this. */
  accept?: string;
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
  shape?: "square" | "round" | "landscape";
  /** Form-owned selection state and accessible field feedback. */
  control?: FieldControlProps;
  inputName?: string;
  onImageLoad?: JSX.GenericEventHandler<HTMLImageElement>;
  onImageError?: JSX.GenericEventHandler<HTMLImageElement>;
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

export interface PictureTileProps extends PictureTileAppearance, Omit<PictureCommandOptions, "noun"> {
  selection?: never;
}

export interface PictureTileSelectionProps extends PictureTileAppearance {
  /** Selects a draft image; the enclosing form owns saving and validation. */
  selection: { onSelectFile: (file: File) => void; onRemove?: () => void };
}

export function PictureTile(props: PictureTileProps | PictureTileSelectionProps) {
  if (props.selection)
    return (
      <PictureTileView
        {...props}
        busy={false}
        attempt={0}
        onSelectFile={props.selection.onSelectFile}
        onRemove={props.selection.onRemove}
      />
    );
  return <StoredPictureTile {...props} />;
}

function StoredPictureTile(props: PictureTileProps) {
  const commands = usePictureCommands({ ...props, noun: props.noun ?? "logo" });
  return (
    <PictureTileView
      {...props}
      busy={commands.busy}
      attempt={commands.attempt}
      onSelectFile={(file) => {
        void commands.upload(file);
      }}
      onRemove={
        commands.remove
          ? () => {
              void commands.remove?.();
            }
          : undefined
      }
    />
  );
}

interface PictureTileViewProps extends PictureTileAppearance {
  busy: boolean;
  attempt: number;
  onSelectFile: (file: File) => void;
  onRemove?: () => void;
}

function PictureTileView(props: PictureTileViewProps) {
  const hintId = useId();
  const noun = props.noun ?? "logo";
  const { busy, attempt } = props;
  const remove = props.onRemove;
  const removeLabel = `Remove ${noun}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const label = props.imageUrl ? `Change ${noun}` : `Upload ${noun}`;

  const picture =
    props.shape === "landscape" ? (
      props.imageUrl ? (
        <img
          src={props.imageUrl}
          alt={props.alt}
          class="pk-picture-tile__image"
          onLoad={props.onImageLoad}
          onError={props.onImageError}
        />
      ) : (
        <span>{label}</span>
      )
    ) : (
      <Avatar
        key={props.imageUrl ?? "missing"}
        name={props.name}
        src={props.imageUrl ?? undefined}
        shape={props.shape ?? "square"}
        class="pk-picture-tile__avatar"
        original
      />
    );

  const sizing =
    (props.size === "mark" ? " pk-picture-tile--mark" : "") +
    (props.shape === "round"
      ? " pk-picture-tile--round"
      : props.shape === "landscape"
        ? " pk-picture-tile--landscape"
        : "");

  const withStanding = (picture: preact.ComponentChildren) =>
    props.status ? <AvatarStanding status={props.status}>{picture}</AvatarStanding> : picture;

  if (!props.canChange) {
    // Avatar draws decorative media; the tile names the photo, or says there is none.
    return withStanding(
      <div
        class={`pk pk-picture-tile pk-picture-tile--static${sizing}`}
        role="img"
        aria-label={props.imageUrl ? props.alt : `${props.name} has no ${noun}`}
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
          {...props.control}
          aria-label={`${label} of ${props.name}`}
          aria-describedby={
            [props.control?.["aria-describedby"], props.hint ? hintId : null].filter(Boolean).join(" ") || undefined
          }
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {picture}
          {/* Touch has no hover, so the tile says it is a control at rest too. */}
          <span class="pk-picture-tile__cue" aria-hidden="true">
            <IconPencil />
          </span>
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
        name={props.inputName}
        accept={props.accept ?? "image/jpeg,image/png,image/webp"}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          event.currentTarget.value = "";
          if (file) props.onSelectFile(file);
        }}
      />
      {/* The file rule is announced with the control, not drawn under the
          mark as a loose sentence: the veil already says what pressing does. */}
      {props.hint && (
        <span id={hintId} class="pk-sr-only">
          {props.hint}
        </span>
      )}
      {props.imageUrl && remove && (
        <button
          type="button"
          class="pk-picture-tile__remove"
          aria-label={`${removeLabel} of ${props.name}`}
          title={removeLabel}
          disabled={busy}
          onClick={remove}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
