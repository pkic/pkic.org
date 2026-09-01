import { useId, useRef, useState } from "preact/hooks";
import { Button } from "../ui/Button";
import { confirmAction } from "./ConfirmDialog";

export interface LogoManagerProps {
  imageUrl: string | null;
  alt: string;
  layout: "centered" | "inline";
  imageClass: string;
  placeholderClass: string;
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

/** Shared accessible logo upload/removal UI. Callers own their API client and auth behavior. */
export function LogoManager(props: LogoManagerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const centered = props.layout === "centered";
  const inputId = useId();
  const hintId = `${inputId}-hint`;
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
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  return (
    // Centered stacks the picture over its controls; inline puts them side by
    // side. Both take their spacing from the parent's gap rather than from a
    // margin on the picture.
    <div class={centered ? "pk pk-stack pk-stack--snug pk-center" : "pk pk-cluster"}>
      {props.imageUrl ? (
        <img src={props.imageUrl} alt={props.alt} class={props.imageClass} />
      ) : (
        <div class={props.placeholderClass}>No logo</div>
      )}
      <div class="pk-stack pk-stack--tight">
        <label class="pk-field__label" for={inputId}>
          {uploadLabel}
        </label>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={props.accept ?? "image/jpeg,image/png,image/webp"}
          class="pk-input"
          disabled={busy}
          // The policy is tied to the control it constrains rather than left
          // as a line of prose underneath it.
          aria-describedby={props.hint ? hintId : undefined}
          onChange={(event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
        {props.hint && (
          <p id={hintId} class="pk-field__help">
            {props.hint}
          </p>
        )}
        {props.imageUrl && (
          <div class={centered ? "pk-cluster pk-cluster--center" : "pk-cluster"}>
            {/* `loading` rather than `disabled`: a disabled control loses
                focus, which throws a screen-reader user out of the form. */}
            <Button variant="danger-quiet" size="sm" loading={busy} onClick={() => void remove()}>
              {props.removeLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
