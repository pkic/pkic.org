import { useEffect, useRef } from "preact/hooks";
import { Button } from "../../ui/Button";
import { wireHeadshotController } from "./controller";
import type { HeadshotDisclaimerOptions } from "./upload";
import type { HeadshotPreviewOptions } from "./preview";

export const ADMIN_HEADSHOT_DISCLAIMER: string[] = [
  "This is a photograph of the named individual.",
  "PKI Consortium holds the copyright, or has an unrestricted, royalty-free license to use and publish this image.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "PKI Consortium may display this image alongside the individual's name and professional details on the website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

interface AdminHeadshotManagerProps {
  initialUrl: string | null;
  alt: string;
  emptyLabel?: string;
  statusText?: string;
  readOnly?: boolean;
  uploadHeadshot: (file: Blob) => Promise<{ headshotUrl?: string | null } | void>;
  deleteHeadshot?: () => Promise<void>;
  onUploaded?: (headshotUrl: string | null | undefined) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onError?: (message: string) => void;
  onFetchGravatar?: () => void;
  disclaimerTexts?: string[];
  uploadLabel?: string;
  uploadSuccessStatus?: string;
  deleteSuccessStatus?: string;
  confirmDeleteMessage?: string;
  fetchLabel?: string;
  deleteLabel?: string;
  helpText?: string;
  previewOptions?: Partial<HeadshotPreviewOptions>;
  disclaimerTitle?: string;
}

export function AdminHeadshotManager({
  initialUrl,
  alt,
  emptyLabel = "User",
  statusText,
  readOnly = false,
  uploadHeadshot,
  deleteHeadshot,
  onUploaded,
  onDeleted,
  onError,
  onFetchGravatar,
  disclaimerTexts = ADMIN_HEADSHOT_DISCLAIMER,
  uploadLabel = "Upload headshot",
  uploadSuccessStatus = "Headshot uploaded",
  deleteSuccessStatus = "Headshot removed",
  confirmDeleteMessage = "Remove headshot?",
  fetchLabel = "Fetch from Gravatar",
  deleteLabel = "Remove headshot",
  helpText,
  previewOptions,
  disclaimerTitle = "Before uploading a photo",
}: AdminHeadshotManagerProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The controller wires the delete control imperatively, so it needs the
  // element. The button is a `Button`, which owns its own markup, so the
  // element is found through the group it renders into rather than by putting
  // a ref on the component and hoping it forwards one.
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wireHeadshotController({
      preview: previewRef.current,
      status: statusRef.current,
      fileInput: fileRef.current,
      deleteButton: actionsRef.current?.querySelector<HTMLButtonElement>("[data-headshot-delete]") ?? null,
      initialUrl,
      // The extra class lists are gone rather than translated: the round
      // frame, the border, the cover-fit image and the centered placeholder
      // are all already `pkic-headshot-preview`'s own rules, so the Bootstrap
      // names were decorating a shape that did not depend on them.
      previewOptions: { alt, emptyLabel, ...previewOptions },
      disclaimerOptions: {
        title: disclaimerTitle,
        texts: disclaimerTexts,
        confirmText: "Proceed",
      } satisfies HeadshotDisclaimerOptions,
      uploadSuccessStatus,
      deleteSuccessStatus,
      confirmDeleteMessage,
      resetListeners: true,
      uploadHeadshot,
      deleteHeadshot,
      onUploaded,
      onDeleted,
      onError: (message) => onError?.(message),
    });
  }, [
    alt,
    confirmDeleteMessage,
    deleteHeadshot,
    deleteSuccessStatus,
    disclaimerTexts,
    disclaimerTitle,
    emptyLabel,
    initialUrl,
    onDeleted,
    onError,
    onUploaded,
    previewOptions,
    readOnly,
    uploadHeadshot,
    uploadSuccessStatus,
  ]);

  useEffect(() => {
    if (statusRef.current && statusText !== undefined) {
      statusRef.current.textContent = statusText;
    }
  }, [statusText]);

  return (
    <div class="pk pk-stack pk-stack--snug pk-center">
      <div ref={previewRef}></div>
      {!readOnly && (
        // A group rather than a bare div: the three controls act on one thing,
        // and the name says which one when the page carries several.
        <div ref={actionsRef} class="pk-stack pk-stack--snug" role="group" aria-label={`Photo for ${alt}`}>
          {/* The button is the control and the file input is opened through
              it, so there is one focusable thing carrying one accessible name
              — rather than a label wrapping an input a class has hidden. */}
          <Button size="sm" block onClick={() => fileRef.current?.click()}>
            {uploadLabel}
          </Button>
          {/* Named even though it is hidden and driven by the button above it:
              `hidden` keeps it out of the accessibility tree today, and an
              unnamed control is one restyle away from being announced as
              "edit, blank". */}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label={uploadLabel} hidden />
          {onFetchGravatar && (
            <Button variant="secondary" size="sm" block onClick={() => void onFetchGravatar()}>
              {fetchLabel}
            </Button>
          )}
          {/* `hidden` until there is something to remove; the controller sets
              the attribute. */}
          <Button data-headshot-delete variant="danger-quiet" size="sm" block hidden>
            {deleteLabel}
          </Button>
        </div>
      )}
      {helpText && <p class="pk-small pk-start">{helpText}</p>}
      {/* The controller writes the outcome here with `textContent`, which no
          reader is told about unless the region announces itself. */}
      <div ref={statusRef} class="pk-small" role="status"></div>
    </div>
  );
}
