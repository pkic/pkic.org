type ClassListInput = string | string[] | undefined;

export interface HeadshotPreviewOptions {
  alt?: string;
  emptyLabel?: string;
  containerClass?: ClassListInput;
  imageClass?: ClassListInput;
  placeholderClass?: ClassListInput;
}

function addClasses(element: Element, classes: ClassListInput): void {
  if (!classes) return;
  const values = Array.isArray(classes) ? classes : classes.split(/\s+/);
  values.filter(Boolean).forEach((className) => element.classList.add(className));
}

export function renderHeadshotPreview(
  preview: HTMLElement | null,
  headshotUrl: string | null | undefined,
  options?: HeadshotPreviewOptions,
): void {
  if (!preview) return;

  preview.textContent = "";
  preview.classList.add("pkic-headshot-preview");
  addClasses(preview, options?.containerClass);

  const alt = options?.alt ?? "Headshot preview";
  const emptyLabel = options?.emptyLabel ?? "No headshot uploaded yet.";

  if (headshotUrl) {
    const image = document.createElement("img");
    image.src = headshotUrl;
    image.alt = alt;
    image.classList.add("pkic-headshot-preview__image");
    addClasses(image, options?.imageClass);
    preview.append(image);
    return;
  }

  const placeholder = document.createElement("div");
  placeholder.classList.add("pkic-headshot-preview__placeholder");
  addClasses(placeholder, options?.placeholderClass);

  const label = document.createElement("span");
  label.textContent = emptyLabel;
  placeholder.append(label);
  preview.append(placeholder);
}
