import { render } from "preact";

type ClassListInput = string | string[] | undefined;

export interface HeadshotPreviewOptions {
  alt?: string;
  emptyLabel?: string;
  containerClass?: ClassListInput;
  imageClass?: ClassListInput;
  placeholderClass?: ClassListInput;
}

function classNames(...inputs: ClassListInput[]): string {
  return inputs
    .flatMap((c) => (Array.isArray(c) ? c : (c?.split(/\s+/) ?? [])))
    .filter(Boolean)
    .join(" ");
}

function HeadshotPreviewContent({
  headshotUrl,
  options,
}: {
  headshotUrl: string | null | undefined;
  options?: HeadshotPreviewOptions;
}) {
  const alt = options?.alt ?? "Headshot preview";
  const emptyLabel = options?.emptyLabel ?? "No headshot uploaded yet.";

  if (headshotUrl) {
    return <img src={headshotUrl} alt={alt} class={classNames("pkic-headshot-preview__image", options?.imageClass)} />;
  }

  return (
    <div class={classNames("pkic-headshot-preview__placeholder", options?.placeholderClass)}>
      <span>{emptyLabel}</span>
    </div>
  );
}

export function renderHeadshotPreview(
  preview: HTMLElement | null,
  headshotUrl: string | null | undefined,
  options?: HeadshotPreviewOptions,
): void {
  if (!preview) return;

  preview.className = classNames("pkic-headshot-preview", options?.containerClass);
  render(<HeadshotPreviewContent headshotUrl={headshotUrl} options={options} />, preview);
}
