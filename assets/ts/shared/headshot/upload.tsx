import { render } from "preact";
import { mountModalTemplate } from "../modal-template";

const HEADSHOT_DISCLAIMER_TEXT = [
  "This is a photograph of myself.",
  "I hold the copyright to this image, or I have an unrestricted, royalty-free licence to use and publish it.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "I grant PKI Consortium a non-exclusive, worldwide licence to display this image alongside my name and professional details on this website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed reading image"));
    reader.readAsDataURL(blob);
  });
}

async function readImage(blob: Blob): Promise<HTMLImageElement> {
  const dataUrl = await blobToDataUrl(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed decoding image"));
    image.src = dataUrl;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export interface HeadshotDisclaimerOptions {
  title?: string;
  texts?: string[];
  confirmText?: string;
}

export function showHeadshotDisclaimer(opts: HeadshotDisclaimerOptions = {}): Promise<boolean> {
  const { title = "Before you upload a photo", texts = HEADSHOT_DISCLAIMER_TEXT, confirmText = "Upload photo" } = opts;

  return new Promise((resolve) => {
    const modal = mountModalTemplate(
      "headshot-disclaimer-template",
      "headshot-disclaimer-modal",
      "Headshot disclaimer",
    );
    if (!modal) {
      resolve(false);
      return;
    }

    // Update content
    const titleEl = modal.querySelector<HTMLElement>(".hsd-title");
    const listEl = modal.querySelector<HTMLUListElement>(".hsd-list");
    const confirmBtn = modal.querySelector<HTMLButtonElement>(".hsd-confirm");
    const checkbox = modal.querySelector<HTMLInputElement>(".hsd-agree");
    const cancelBtn = modal.querySelector<HTMLButtonElement>(".hsd-cancel");
    const overlay = modal.querySelector<HTMLElement>(".hsd-overlay");
    const form = modal.querySelector<HTMLFormElement>(".hsd-form");

    if (!titleEl || !listEl || !confirmBtn || !checkbox || !cancelBtn || !overlay || !form) {
      console.error("Headshot disclaimer template is incomplete");
      modal.remove();
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    render(
      <>
        {texts.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </>,
      listEl,
    );
    confirmBtn.textContent = confirmText;
    checkbox.checked = false;
    confirmBtn.disabled = true;

    // Show modal
    modal.classList.add("hsd-active");

    const cleanup = () => {
      modal.remove();
    };

    checkbox.addEventListener("change", () => {
      confirmBtn.disabled = !checkbox.checked;
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (checkbox.checked) {
        cleanup();
        resolve(true);
      }
    });

    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(false);
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    });
  });
}

export async function prepareHeadshotUploadBlob(croppedBlob: Blob, maxBytes: number): Promise<Blob> {
  if (croppedBlob.size <= maxBytes) {
    return croppedBlob;
  }

  const image = await readImage(croppedBlob);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  for (const scale of [1, 0.9, 0.8, 0.7, 0.6]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(256, Math.round(width * scale));
    canvas.height = Math.max(256, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
      const candidate = await canvasToJpeg(canvas, quality);
      if (candidate.size <= maxBytes) {
        return candidate;
      }
    }
  }

  throw new Error("Could not reduce image below upload limit. Please choose a smaller source image.");
}
