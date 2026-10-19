/**
 * Shared headshot crop UI.
 *
 * Usage:
 *   const blob = await cropHeadshot(file);
 *   if (blob) { // upload blob }
 *
 * Returns a JPEG Blob if the user confirmed, or null if they cancelled.
 */

import "../../site/headshot-dialogs.css";
import { dismissModalDialog, mountModalTemplate, openModalDialog } from "../modal-template";

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
  const canvas = viewport?.querySelector("canvas") ?? null;
  const ctx = canvas?.getContext("2d");
  const slider = dialog.querySelector(".crop-headshot-slider") as HTMLInputElement | null;
  const cancelBtn = dialog.querySelector(".crop-headshot-cancel") as HTMLButtonElement | null;
  const confirmBtn = dialog.querySelector(".crop-headshot-confirm") as HTMLButtonElement | null;

  if (!viewport || !canvas || !ctx || !slider || !cancelBtn || !confirmBtn) {
    console.error("Crop headshot template is incomplete", { viewport, canvas, slider, cancelBtn, confirmBtn });
    dialog.remove();
    fail(new Error("Crop modal is missing required elements. Please reload the page and try again."));
    return;
  }

  const dialogEl = dialog;
  const preview = canvas;
  const context = ctx;

  openModalDialog(dialog);

  // ── Initial scale (cover) ─────────────────────────────────────────────────
  // Coordinates are fractions of the square, independent of borders and resizing.
  const viewportSize = 1;
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const minDim = Math.min(naturalW, naturalH);
  const fitScale = viewportSize / minDim;
  const minScale = fitScale;
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

  function renderCrop(): void {
    context.drawImage(
      img,
      -panX / scale,
      -panY / scale,
      viewportSize / scale,
      viewportSize / scale,
      0,
      0,
      preview.width,
      preview.height,
    );
  }

  clampPan();
  renderCrop();

  // ── Drag to pan ───────────────────────────────────────────────────────────
  let dragging = false;
  let dragStartX = 0,
    dragStartY = 0,
    panStartX = 0,
    panStartY = 0;

  viewport.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    viewport.focus();
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    viewport.classList.add("dragging");
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX) / viewport.clientWidth;
    panY = panStartY + (e.clientY - dragStartY) / viewport.clientHeight;
    clampPan();
    renderCrop();
  });
  function stopDragging(): void {
    dragging = false;
    viewport!.classList.remove("dragging");
  }
  viewport.addEventListener("pointerup", stopDragging);
  viewport.addEventListener("pointercancel", stopDragging);
  viewport.addEventListener("lostpointercapture", stopDragging);

  viewport.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    switch (e.key) {
      case "ArrowLeft":
        panX -= step;
        break;
      case "ArrowRight":
        panX += step;
        break;
      case "ArrowUp":
        panY -= step;
        break;
      case "ArrowDown":
        panY += step;
        break;
      default:
        return;
    }
    e.preventDefault();
    clampPan();
    renderCrop();
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
    renderCrop();
  });

  // ── Mouse-wheel zoom ──────────────────────────────────────────────────────
  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const newScale = Math.min(maxScale, Math.max(minScale, scale * (1 + delta)));
      const rect = viewport.getBoundingClientRect();
      const cx = (e.clientX - rect.left - viewport.clientLeft) / viewport.clientWidth;
      const cy = (e.clientY - rect.top - viewport.clientTop) / viewport.clientHeight;
      panX = cx - ((cx - panX) / scale) * newScale;
      panY = cy - ((cy - panY) / scale) * newScale;
      scale = newScale;
      clampPan();
      renderCrop();
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
