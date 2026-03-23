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
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode image"));
        return;
      }
      resolve(blob);
    }, "image/jpeg", quality);
  });
}

export function showHeadshotDisclaimer(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:1rem";
    const card = document.createElement("div");
    card.style.cssText =
      "background:#fff;border-radius:.5rem;max-width:520px;width:100%;padding:1.5rem;box-shadow:0 8px 32px rgba(0,0,0,.25)";
    card.innerHTML = `
      <h4 style="margin:0 0 .75rem;font-size:1.1rem">Before you upload a photo</h4>
      <p style="font-size:.875rem;margin:0 0 1rem">Please confirm all of the following:</p>
      <form>
        ${HEADSHOT_DISCLAIMER_TEXT.map((text, i) => `
          <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:flex-start">
            <input type="checkbox" id="hsd-${i}" style="margin-top:.2rem;flex-shrink:0">
            <label for="hsd-${i}" style="font-size:.875rem">${text}</label>
          </div>`).join("")}
        <div style="display:flex;gap:.5rem;margin-top:1rem">
          <button type="submit" id="hsd-confirm" class="btn btn-success btn-sm" disabled>Continue to crop →</button>
          <button type="button" id="hsd-cancel" class="btn btn-outline-secondary btn-sm">Cancel</button>
        </div>
      </form>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const confirmBtn = card.querySelector<HTMLButtonElement>("#hsd-confirm")!;
    const cancelBtn = card.querySelector<HTMLButtonElement>("#hsd-cancel")!;
    const checkboxes = Array.from(card.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));

    function updateConfirm(): void {
      confirmBtn.disabled = !checkboxes.every((cb) => cb.checked);
    }
    for (const cb of checkboxes) cb.addEventListener("change", updateConfirm);

    card.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (checkboxes.every((cb) => cb.checked)) { overlay.remove(); resolve(true); }
    });
    cancelBtn.addEventListener("click", () => { overlay.remove(); resolve(false); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

export async function prepareHeadshotUploadBlob(
  croppedBlob: Blob,
  maxBytes: number,
): Promise<Blob> {
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