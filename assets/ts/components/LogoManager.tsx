import { useRef, useState } from "preact/hooks";

export interface LogoManagerProps {
  imageUrl: string | null;
  alt: string;
  layout: "centered" | "inline";
  imageClass: string;
  placeholderClass: string;
  removeConfirmation: string;
  removeLabel: string;
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
    if (!confirm(props.removeConfirmation)) return;
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
    <div class={centered ? "text-center" : "d-flex align-items-center gap-3 mb-3"}>
      {props.imageUrl ? (
        <img src={props.imageUrl} alt={props.alt} class={props.imageClass} />
      ) : (
        <div class={props.placeholderClass}>No logo</div>
      )}
      <div class={centered ? "d-flex gap-2 justify-content-center" : "d-flex flex-column gap-1"}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class={`form-control form-control-sm${centered ? " w-auto" : ""}`}
          disabled={busy}
          onChange={(event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
        {props.imageUrl && (
          <button type="button" class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
            {props.removeLabel}
          </button>
        )}
      </div>
    </div>
  );
}
