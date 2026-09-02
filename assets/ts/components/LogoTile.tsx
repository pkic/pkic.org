/**
 * LogoTile — the logo as the whole affordance.
 *
 * A record's mark sits in a tile: the picture when there is one, the name's
 * initials when there is not — the same reading a person's avatar gets. For
 * someone who may change it, the tile itself is the control: hovering or
 * focusing it says "Change logo", activating it opens the file chooser, and
 * a quiet Remove appears beside it. No panel header, no button standing
 * open next to the picture — the common pattern for a profile picture, here
 * for an organization's mark.
 */
import { useId, useRef } from "preact/hooks";
import { Button } from "../ui/Button";
import { initialsFrom } from "../ui/Avatar";
import { useLogoCommands, type LogoManagerProps } from "./LogoManager";
import "./LogoTile.css";

export interface LogoTileProps extends Omit<LogoManagerProps, "hint" | "uploadLabel"> {
  /** The name whose initials stand in while there is no picture. */
  name: string;
  /** Whether the reader may change the mark. Read-only viewers get the tile alone. */
  canChange: boolean;
  /** What the file rule is, announced with the control. */
  hint?: string;
}

export function LogoTile(props: LogoTileProps) {
  const hintId = useId();
  const { busy, attempt, upload, remove } = useLogoCommands(props);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = props.imageUrl ? "Change logo" : "Upload logo";

  const picture = props.imageUrl ? (
    <img class="pk-logo-tile__img" src={props.imageUrl} alt={props.alt} />
  ) : (
    <span class="pk-logo-tile__initials" aria-hidden="true">
      {initialsFrom(props.name)}
    </span>
  );

  if (!props.canChange) {
    return (
      <div class="pk pk-logo-tile" role="img" aria-label={props.imageUrl ? props.alt : `${props.name} has no logo`}>
        {picture}
      </div>
    );
  }

  return (
    <div class="pk pk-logo-tile pk-logo-tile--editable">
      <button
        type="button"
        class="pk-logo-tile__control"
        aria-label={label}
        aria-describedby={props.hint ? hintId : undefined}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {picture}
        <span class="pk-logo-tile__veil" aria-hidden="true">
          {busy ? "Uploading…" : label}
        </span>
      </button>
      <input
        key={attempt}
        ref={inputRef}
        class="pk-logo-tile__input"
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
        <div class="pk-logo-tile__actions">
          <Button variant="danger-quiet" size="sm" loading={busy} onClick={() => void remove()}>
            {props.removeLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
