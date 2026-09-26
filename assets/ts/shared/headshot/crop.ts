/**
 * Shared headshot crop UI.
 *
 * Usage:
 *   const blob = await cropHeadshot(file);
 *   if (blob) { // upload blob }
 *
 * Returns a JPEG Blob if the user confirmed, or null if they cancelled.
 */

import { dismissModalDialog, mountModalTemplate, openModalDialog } from "../modal-template";

const CROP_OUTPUT_SIZE = 1024; // px — square output

/**
 * Opens the image in a modal crop dialog.
 * Resolves with a JPEG Blob on confirm, or null on cancel.
 */
export function cropHeadshot(file: File): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => showCropModal(img, resolve, reject);
      img.onerror = () => reject(new Error("Failed to decode image. Please try a different file."));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

function showCropModal(img: HTMLImageElement, done: (blob: Blob | null) => void, fail: (error: Error) => void): void {
  // ── Get or create dialog from template ─────────────────────────────────────
  const dialog = mountModalTemplate("crop-headshot-template", "crop-headshot-modal", "Crop headshot");
  if (!dialog) {
    fail(new Error("Crop modal template not found. Please reload the page and try again."));
    return;
  }

  const viewport = dialog.querySelector(".crop-headshot-viewport") as HTMLElement | null;
  const imgEl = viewport?.querySelector("img") as HTMLImageElement | null;
  const slider = dialog.querySelector(".crop-headshot-slider") as HTMLInputElement | null;
  const cancelBtn = dialog.querySelector(".crop-headshot-cancel") as HTMLButtonElement | null;
  const confirmBtn = dialog.querySelector(".crop-headshot-confirm") as HTMLButtonElement | null;

  if (!viewport || !imgEl || !slider || !cancelBtn || !confirmBtn) {
    console.error("Crop headshot template is incomplete", { viewport, imgEl, slider, cancelBtn, confirmBtn });
    dialog.remove();
    fail(new Error("Crop modal is missing required elements. Please reload the page and try again."));
    return;
  }

  const dialogEl = dialog;
  const imageEl = imgEl;

  imgEl.src = img.src;
  // Opened before anything is measured: a `<dialog>` is `display: none` until
  // it is, and a viewport measured while it is hidden is zero wide, which puts
  // the initial scale — and therefore the whole crop — at infinity.
  openModalDialog(dialog);

  // ── Initial scale (cover) ─────────────────────────────────────────────────
  const viewportSize = Math.round(viewport.getBoundingClientRect().width);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const minDim = Math.min(naturalW, naturalH);
  const fitScale = viewportSize / minDim;
  const minScale = fitScale * 0.5;
  const maxScale = fitScale * 4;

  let scale = fitScale;
  let panX = -(naturalW * scale - viewportSize) / 2;
  let panY = -(naturalH * scale - viewportSize) / 2;

  function clampPan(): void {
    const imgW = naturalW * scale;
    const imgH = naturalH * scale;
    panX = Math.min(0, Math.max(viewportSize - imgW, panX));
    panY = Math.min(0, Math.max(viewportSize - imgH, panY));
  }

  function applyTransform(): void {
    imageEl.style.width = `${naturalW * scale}px`;
    imageEl.style.height = `${naturalH * scale}px`;
    imageEl.style.left = `${panX}px`;
    imageEl.style.top = `${panY}px`;
  }

  clampPan();
  applyTransform();

  // ── Drag to pan ───────────────────────────────────────────────────────────
  let dragging = false;
  let dragStartX = 0,
    dragStartY = 0,
    panStartX = 0,
    panStartY = 0;

  viewport.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    viewport.classList.add("dragging");
    viewport.setPointerCapture((e as PointerEvent).pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    clampPan();
    applyTransform();
  });
  viewport.addEventListener("pointerup", () => {
    dragging = false;
    viewport.classList.remove("dragging");
  });

  // ── Zoom slider ───────────────────────────────────────────────────────────
  slider.value = String(((fitScale - minScale) / (maxScale - minScale)) * 100);

  slider.addEventListener("input", () => {
    const newScale = minScale + (parseFloat(slider.value) / 100) * (maxScale - minScale);
    const cx = viewportSize / 2;
    const cy = viewportSize / 2;
    panX = cx - ((cx - panX) / scale) * newScale;
    panY = cy - ((cy - panY) / scale) * newScale;
    scale = newScale;
    clampPan();
    applyTransform();
  });

  // ── Mouse-wheel zoom ──────────────────────────────────────────────────────
  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const newScale = Math.min(maxScale, Math.max(minScale, scale * (1 + delta)));
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      panX = cx - ((cx - panX) / scale) * newScale;
      panY = cy - ((cy - panY) / scale) * newScale;
      scale = newScale;
      clampPan();
      applyTransform();
      slider.value = String(((scale - minScale) / (maxScale - minScale)) * 100);
    },
    { passive: false },
  );

  // ── Event handlers ────────────────────────────────────────────────────────
  /** The one way out: the dialog comes down, focus goes back to whatever
   *  opened it, and the caller is answered. */
  function dismiss(blob: Blob | null): void {
    dismissModalDialog(dialogEl);
    done(blob);
  }

  cancelBtn.addEventListener("click", () => dismiss(null), { once: true });

  // Escape and the platform's close request both arrive as `cancel`, and both
  // mean the same thing here as the Cancel button: no cropped image. It is
  // prevented so dismissal goes through the path that restores focus.
  dialogEl.addEventListener("cancel", (e) => {
    e.preventDefault();
    dismiss(null);
  });

  confirmBtn.addEventListener(
    "click",
    () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Processing…";

      const canvas = document.createElement("canvas");
      canvas.width = CROP_OUTPUT_SIZE;
      canvas.height = CROP_OUTPUT_SIZE;
      const ctx = canvas.getContext("2d")!;

      const srcX = -panX / scale;
      const srcY = -panY / scale;
      const srcSize = viewportSize / scale;

      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            dismissModalDialog(dialogEl);
            fail(new Error("Failed to encode cropped image. Please try a different file."));
            return;
          }
          dismiss(blob);
        },
        "image/jpeg",
        0.92,
      );
    },
    { once: true },
  );
}
