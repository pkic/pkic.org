import { useEffect, useRef } from "preact/hooks";
import { wireHeadshotController } from "./controller";
import type { HeadshotDisclaimerOptions } from "./upload";
import type { HeadshotPreviewOptions } from "./preview";

export const ADMIN_HEADSHOT_DISCLAIMER: string[] = [
  "This is a photograph of the named individual.",
  "PKI Consortium holds the copyright, or has an unrestricted, royalty-free licence to use and publish this image.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "PKI Consortium may display this image alongside the individual's name and professional details on the website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

interface AdminHeadshotManagerProps {
  initialUrl: string | null;
  alt: string;
  emptyLabel?: string;
  statusText?: string;
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
  uploadHeadshot,
  deleteHeadshot,
  onUploaded,
  onDeleted,
  onError,
  onFetchGravatar,
  disclaimerTexts = ADMIN_HEADSHOT_DISCLAIMER,
  uploadLabel = "📷 Upload headshot",
  uploadSuccessStatus = "Headshot uploaded",
  deleteSuccessStatus = "Headshot removed",
  confirmDeleteMessage = "Remove headshot?",
  fetchLabel = "🌐 Fetch from Gravatar",
  deleteLabel = "🗑 Remove headshot",
  helpText,
  previewOptions,
  disclaimerTitle = "Before uploading a photo",
}: AdminHeadshotManagerProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    wireHeadshotController({
      preview: previewRef.current,
      status: statusRef.current,
      fileInput: fileRef.current,
      deleteButton: deleteRef.current,
      initialUrl,
      previewOptions: {
        alt,
        emptyLabel,
        containerClass: "adm-headshot-preview",
        imageClass: ["rounded-circle", "border", "shadow-sm", "adm-headshot-preview-img"],
        placeholderClass: [
          "rounded-circle",
          "border",
          "bg-light",
          "d-flex",
          "align-items-center",
          "justify-content-center",
          "mx-auto",
          "adm-headshot-placeholder",
        ],
        ...previewOptions,
      },
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
    uploadHeadshot,
    uploadSuccessStatus,
  ]);

  useEffect(() => {
    if (statusRef.current && statusText !== undefined) {
      statusRef.current.textContent = statusText;
    }
  }, [statusText]);

  return (
    <div class="mb-3 text-center">
      <div ref={previewRef} class="mb-2"></div>
      <div class="d-flex flex-column gap-2 align-items-center">
        <label class="btn btn-sm btn-outline-primary w-100 adm-headshot-btn">
          {uploadLabel}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" class="d-none" />
        </label>
        {onFetchGravatar && (
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary w-100 adm-headshot-btn"
            onClick={() => void onFetchGravatar()}
          >
            {fetchLabel}
          </button>
        )}
        <button ref={deleteRef} type="button" class="btn btn-sm btn-outline-danger w-100 adm-headshot-btn d-none">
          {deleteLabel}
        </button>
      </div>
      {helpText && <div class="form-text mt-2 text-start">{helpText}</div>}
      <div ref={statusRef} class="mt-2 small text-muted"></div>
    </div>
  );
}
