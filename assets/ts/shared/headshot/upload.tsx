import { render } from "preact";
import { dismissModalDialog, mountModalTemplate, openModalDialog } from "../modal-template";

const HEADSHOT_DISCLAIMER_TEXT = [
  "This is a photograph of myself.",
  "I hold the copyright to this image, or I have an unrestricted, royalty-free license to use and publish it.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "I grant PKI Consortium a non-exclusive, worldwide license to display this image alongside my name and professional details on this website and related materials.",
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
    const dialog = mountModalTemplate(
      "headshot-disclaimer-template",
      "headshot-disclaimer-modal",
      "Headshot disclaimer",
    );
    if (!dialog) {
      resolve(false);
      return;
    }

    // Update content
    const titleEl = dialog.querySelector<HTMLElement>(".hsd-title");
    const listEl = dialog.querySelector<HTMLUListElement>(".hsd-list");
    const confirmBtn = dialog.querySelector<HTMLButtonElement>(".hsd-confirm");
    const checkbox = dialog.querySelector<HTMLInputElement>(".hsd-agree");
    const cancelBtn = dialog.querySelector<HTMLButtonElement>(".hsd-cancel");
    const form = dialog.querySelector<HTMLFormElement>(".hsd-form");

    if (!titleEl || !listEl || !confirmBtn || !checkbox || !cancelBtn || !form) {
      console.error("Headshot disclaimer template is incomplete");
      // Taken back down rather than left half-built in the page: a dialog with
      // a missing control cannot be agreed to or backed out of.
      dialog.remove();
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

    openModalDialog(dialog);

    /** Every way out of the dialog goes through here, so focus is returned and
     *  the caller is answered exactly once whichever one the reader took. */
    const settle = (agreed: boolean) => {
      dismissModalDialog(dialog);
      resolve(agreed);
    };

    checkbox.addEventListener("change", () => {
      confirmBtn.disabled = !checkbox.checked;
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // The button is disabled until the box is ticked, but a form can also be
      // submitted from the keyboard, so the agreement is re-checked here.
      if (checkbox.checked) settle(true);
    });

    cancelBtn.addEventListener("click", () => settle(false));

    // Escape and the platform's close request both arrive as `cancel`. It is
    // prevented so the dialog comes down through `settle` — which returns
    // focus and answers the caller — rather than through the platform's own
    // close, which would do neither.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(false);
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
