import { wireHeadshotController } from "../shared/headshot/controller";
import { setStatus } from "./boot";
import { registrationHeadshotUploadResponseSchema } from "../../shared/schemas/registration";
import { successResponseSchema } from "../../shared/schemas/api-common";
import { requestJson } from "../shared/api-client";

interface TokenHeadshotSectionOptions {
  root: HTMLElement;
  initialHeadshotUrl: string | null | undefined;
  statusEl: HTMLElement;
  uploadUrl: string;
  deleteUrl?: string;
  emptyLabel?: string;
  uploadSuccessStatus?: string;
  deleteSuccessStatus?: string;
  confirmDeleteMessage?: string;
  onChanged?: () => void;
}

export function wireTokenHeadshotSection({
  root,
  initialHeadshotUrl,
  statusEl,
  uploadUrl,
  deleteUrl,
  emptyLabel = "No photo",
  uploadSuccessStatus = "Photo updated. Your social badge has been updated.",
  deleteSuccessStatus = "Photo removed. Your social badge has been updated.",
  confirmDeleteMessage = "Remove your profile photo?",
  onChanged,
}: TokenHeadshotSectionOptions): void {
  const section = root.querySelector<HTMLElement>("[data-headshot-section]");
  if (!section) return;

  const preview = section.querySelector<HTMLElement>("[data-headshot-preview]");
  const headshotStatus = section.querySelector<HTMLElement>("[data-headshot-status]");
  const fileInput = section.querySelector<HTMLInputElement>("[data-headshot-file]");
  const deleteBtn = section.querySelector<HTMLButtonElement>("[data-headshot-delete]");

  wireHeadshotController({
    preview,
    status: headshotStatus,
    fileInput,
    deleteButton: deleteBtn,
    initialUrl: initialHeadshotUrl ?? null,
    previewOptions: { alt: "Your headshot", emptyLabel },
    uploadStatus: "Uploading...",
    uploadSuccessStatus,
    deleteSuccessStatus,
    confirmDeleteMessage,
    uploadHeadshot: async (cropped) => {
      const form = new FormData();
      form.append("file", cropped, "headshot.jpg");
      form.append("consent", "true");
      const data = await requestJson(uploadUrl, registrationHeadshotUploadResponseSchema, {
        method: "PUT",
        body: form,
      });
      return { headshotUrl: data.headshotUrl ?? null };
    },
    deleteHeadshot: deleteUrl
      ? async () => {
          await requestJson(deleteUrl, successResponseSchema, {
            method: "DELETE",
          });
        }
      : undefined,
    onUploaded: () => {
      onChanged?.();
    },
    onDeleted: () => {
      onChanged?.();
    },
    onError: (message, action) => {
      const verb = action === "upload" ? "upload" : "remove";
      setStatus(statusEl, `Failed to ${verb} headshot: ${message}`, true);
    },
  });
}

export function wireHeadshotSection(
  root: HTMLElement,
  token: string,
  apiBase: string,
  initialHeadshotUrl: string | null | undefined,
  statusEl: HTMLElement,
  onChanged?: () => void,
): void {
  wireTokenHeadshotSection({
    root,
    initialHeadshotUrl,
    statusEl,
    uploadUrl: `${apiBase}/registrations/manage/${encodeURIComponent(token)}/headshot`,
    deleteUrl: `${apiBase}/registrations/manage/${encodeURIComponent(token)}/headshot`,
    onChanged,
  });
}
