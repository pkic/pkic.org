import { cropHeadshot } from "./crop-headshot";
import { showHeadshotDisclaimer, type HeadshotDisclaimerOptions } from "./headshot-upload";
import { renderHeadshotPreview, type HeadshotPreviewOptions } from "./headshot-preview";

type HeadshotAction = "upload" | "delete";

export interface HeadshotUploadResult {
  headshotUrl?: string | null;
}

export interface HeadshotControllerOptions {
  preview: HTMLElement | null;
  status: HTMLElement | null;
  fileInput: HTMLInputElement | null;
  deleteButton?: HTMLButtonElement | null;
  initialUrl?: string | null;
  previewOptions?: HeadshotPreviewOptions;
  disclaimerOptions?: HeadshotDisclaimerOptions;
  maxRawMb?: number;
  uploadStatus?: string;
  uploadSuccessStatus?: string;
  deleteSuccessStatus?: string;
  confirmDeleteMessage?: string;
  resetListeners?: boolean;
  uploadHeadshot(file: Blob): Promise<HeadshotUploadResult | void>;
  deleteHeadshot?: () => Promise<void>;
  onUploaded?: (headshotUrl: string | null | undefined) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onError?: (message: string, action: HeadshotAction) => void;
}

const DEFAULT_MAX_RAW_MB = 20;

function withFreshListenerTarget<T extends HTMLElement>(element: T | null, reset: boolean): T | null {
  if (!element || !reset) return element;
  const clone = element.cloneNode(true) as T;
  element.replaceWith(clone);
  return clone;
}

function setStatusText(status: HTMLElement | null, message: string): void {
  if (status) status.textContent = message;
}

export function confirmHeadshotUsage(options?: HeadshotDisclaimerOptions): Promise<boolean> {
  return showHeadshotDisclaimer(options);
}

export function wireHeadshotController(options: HeadshotControllerOptions): void {
  const fileInput = withFreshListenerTarget(options.fileInput, options.resetListeners === true);
  const deleteButton = withFreshListenerTarget(options.deleteButton ?? null, options.resetListeners === true);
  let currentUrl = options.initialUrl ?? null;

  function updatePreview(url: string | null | undefined): void {
    currentUrl = url ?? null;
    renderHeadshotPreview(options.preview, currentUrl, options.previewOptions);
    deleteButton?.classList.toggle("d-none", !currentUrl || !options.deleteHeadshot);
  }

  function reportError(error: unknown, action: HeadshotAction): void {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = action === "upload" ? `Upload failed: ${message}` : `Remove failed: ${message}`;
    setStatusText(options.status, fallback);
    options.onError?.(message, action);
  }

  updatePreview(currentUrl);

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void uploadSelectedFile(file);
  });

  deleteButton?.addEventListener("click", () => {
    if (!options.deleteHeadshot) return;
    if (options.confirmDeleteMessage && !confirm(options.confirmDeleteMessage)) return;
    void removeHeadshot();
  });

  async function uploadSelectedFile(file: File): Promise<void> {
    const maxRawMb = options.maxRawMb ?? DEFAULT_MAX_RAW_MB;

    if (file.size > maxRawMb * 1024 * 1024) {
      const message = `Please choose an image under ${maxRawMb} MB.`;
      setStatusText(options.status, message);
      options.onError?.(message, "upload");
      fileInput!.value = "";
      return;
    }

    const accepted = await confirmHeadshotUsage(options.disclaimerOptions);
    if (!accepted) {
      fileInput!.value = "";
      return;
    }

    try {
      const cropped = await cropHeadshot(file);
      if (!cropped) {
        fileInput!.value = "";
        return;
      }

      setStatusText(options.status, options.uploadStatus ?? "Uploading...");
      fileInput!.value = "";

      const result = await options.uploadHeadshot(cropped);
      const nextUrl = result && "headshotUrl" in result ? result.headshotUrl ?? null : currentUrl;
      if (result && "headshotUrl" in result) updatePreview(nextUrl);
      setStatusText(options.status, options.uploadSuccessStatus ?? "Headshot uploaded.");
      await options.onUploaded?.(nextUrl);
    } catch (error) {
      fileInput!.value = "";
      reportError(error, "upload");
    }
  }

  async function removeHeadshot(): Promise<void> {
    if (!options.deleteHeadshot) return;

    try {
      await options.deleteHeadshot();
      updatePreview(null);
      setStatusText(options.status, options.deleteSuccessStatus ?? "Headshot removed.");
      await options.onDeleted?.();
    } catch (error) {
      reportError(error, "delete");
    }
  }
}
