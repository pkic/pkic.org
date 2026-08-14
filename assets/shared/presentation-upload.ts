export const MAX_PRESENTATION_BYTES = 100 * 1024 * 1024;
export const PRESENTATION_FILE_NAME_HEADER = "x-presentation-file-name";
export const PRESENTATION_FILE_SIZE_HEADER = "x-presentation-file-size";

export const ALLOWED_PRESENTATION_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
] as const;

const PRESENTATION_MIME_BY_EXTENSION: Record<string, (typeof ALLOWED_PRESENTATION_MIME_TYPES)[number]> = {
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
};

export function presentationMimeType(file: Pick<File, "name" | "type">): string {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  return (extension && PRESENTATION_MIME_BY_EXTENSION[extension]) || file.type || "application/octet-stream";
}

export function presentationUploadRequest(file: File): { body: File; headers: Record<string, string> } {
  if (file.size <= 0) {
    throw new Error("Presentation file is empty.");
  }
  if (file.size > MAX_PRESENTATION_BYTES) {
    throw new Error("Presentation must be 100 MB or smaller.");
  }

  const mimeType = presentationMimeType(file);
  if (!(ALLOWED_PRESENTATION_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Only PDF and PowerPoint (PPTX/PPT/PPTM/ODP) files are accepted.");
  }

  return {
    body: file,
    headers: {
      "content-type": mimeType,
      [PRESENTATION_FILE_NAME_HEADER]: encodeURIComponent(file.name || "presentation"),
      [PRESENTATION_FILE_SIZE_HEADER]: String(file.size),
    },
  };
}
