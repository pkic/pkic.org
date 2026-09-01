import { useState } from "preact/hooks";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FileInput } from "../ui/FileInput";
import { confirmAction } from "./ConfirmDialog";

export interface LogoManagerProps {
  imageUrl: string | null;
  alt: string;
  removeConfirmation: string;
  removeLabel: string;
  /** Accepted upload types; callers with an SVG-only policy narrow this. */
  accept?: string;
  /** One-line policy hint rendered under the file input. */
  hint?: string;
  /**
   * Names the file input. It had no name at all before — a bare
   * `<input type="file">` announces as "file upload button" and nothing else
   * — so it defaults to whichever of the two things activating it does.
   */
  uploadLabel?: string;
  onUpload: (file: File) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onChanged: () => void;
  toast: (message: string, type: "success" | "error") => void;
}

/**
 * A logo, and the one control that changes it.
 *
 * This used to render three unrelated things in a column: the picture, a raw
 * `<input type="file">` the browser drew in its own font, and a red removal
 * button floating beside the help text. Three affordances, one subject, no
 * frame holding them together — which is most of why every page carrying it
 * looked unfinished.
 *
 * It is one `Field` now. The label names the command ("Replace logo"), the
 * help carries the upload policy and reaches the input through
 * `aria-describedby`, and `FileInput`'s `preview` slot holds the value the
 * field already has — the current logo, with the control that empties it
 * beside the picture it would empty. The slot draws the frame and caps the
 * picture's size, so those are no longer a caller's to pass in: a surface
 * cannot hand this component a Bootstrap class for its logo any more.
 *
 * Callers own their API client, their endpoint, and their notifier.
 */
export function LogoManager(props: LogoManagerProps) {
  const [busy, setBusy] = useState(false);
  /*
   * Bumped after every upload attempt, to remount the file control.
   *
   * The chosen file lives in the native input and in `FileInput`'s own name
   * label, neither of which this component holds a handle on. A refused upload
   * that leaves the file sitting in the control reads as though it took, and a
   * successful one leaves the old file's name beside the new picture.
   * Remounting is how an uncontrolled control is reset without reaching past
   * its API into its DOM.
   */
  const [attempt, setAttempt] = useState(0);
  const uploadLabel = props.uploadLabel ?? (props.imageUrl ? "Replace logo" : "Upload logo");

  async function upload(file: File) {
    setBusy(true);
    try {
      await props.onUpload(file);
      props.toast("Logo uploaded", "success");
      props.onChanged();
    } catch (error) {
      props.toast((error as Error).message, "error");
    } finally {
      setBusy(false);
      setAttempt((current) => current + 1);
    }
  }

  async function remove() {
    const confirmed = await confirmAction({
      title: props.removeConfirmation,
      confirmLabel: props.removeLabel,
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await props.onRemove();
      props.toast("Logo removed", "success");
      props.onChanged();
    } catch (error) {
      props.toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const preview = (
    // A cluster rather than a row of bare children: the removal control wraps
    // under the picture when the field is narrow instead of squeezing it.
    <div class="pk-cluster pk-cluster--center">
      {props.imageUrl ? <img src={props.imageUrl} alt={props.alt} /> : <span>No logo</span>}
      {props.imageUrl && (
        // `loading` rather than `disabled`: a disabled control loses focus,
        // which throws a screen-reader user out of the field.
        <Button variant="danger-quiet" size="sm" loading={busy} onClick={() => void remove()}>
          {props.removeLabel}
        </Button>
      )}
    </div>
  );

  return (
    // The base layer is claimed here rather than assumed: this control is
    // dropped into surfaces that have not adopted it yet, and a field drawn
    // outside `.pk` inherits the page's own type and colour instead of the
    // system's.
    <div class="pk">
      <Field label={uploadLabel} help={props.hint}>
        {(control) => (
          <FileInput
            {...control}
            key={attempt}
            accept={props.accept ?? "image/jpeg,image/png,image/webp"}
            disabled={busy}
            buttonLabel={props.imageUrl ? "Choose replacement" : "Choose file"}
            preview={preview}
            onFileChange={(file) => {
              if (file) void upload(file);
            }}
          />
        )}
      </Field>
    </div>
  );
}
