export function renderHeadshotPreview(
  preview: HTMLElement | null,
  headshotUrl: string | null | undefined,
  options?: {
    alt?: string;
    emptyLabel?: string;
  },
): void {
  if (!preview) return;

  const alt = options?.alt ?? "Headshot preview";
  const emptyLabel = options?.emptyLabel ?? "No headshot uploaded yet.";

  if (headshotUrl) {
    preview.innerHTML = `<img src="${headshotUrl}" alt="${alt}" class="pkic-headshot-preview__image">`;
    return;
  }

  preview.innerHTML = `<div class="pkic-headshot-preview__placeholder"><span>${emptyLabel}</span></div>`;
}