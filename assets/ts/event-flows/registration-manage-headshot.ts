import { wireHeadshotController } from "../shared/headshot/controller";
import { setStatus } from "./boot";

export function wireHeadshotSection(
  root: HTMLElement,
  token: string,
  apiBase: string,
  initialHeadshotUrl: string | null | undefined,
  statusEl: HTMLElement,
  onChanged?: () => void,
): void {
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
    previewOptions: { alt: "Your headshot", emptyLabel: "No photo" },
    uploadStatus: "Uploading...",
    uploadSuccessStatus: "Photo updated. Your social badge has been updated.",
    deleteSuccessStatus: "Photo removed. Your social badge has been updated.",
    confirmDeleteMessage: "Remove your profile photo?",
    uploadHeadshot: async (cropped) => {
      const form = new FormData();
      form.append("file", cropped, "headshot.jpg");
      form.append("consent", "true");
      const res = await fetch(`${apiBase}/registrations/manage/${encodeURIComponent(token)}/headshot`, {
        method: "PUT",
        body: form,
      });
      const data = (await res.json()) as { success?: boolean; headshotUrl?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      return { headshotUrl: data.headshotUrl ?? null };
    },
    deleteHeadshot: async () => {
      const res = await fetch(`${apiBase}/registrations/manage/${encodeURIComponent(token)}/headshot`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      }
    },
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
