/**
 * Shared headshot crop UI.
 *
 * Usage:
 *   const blob = await cropHeadshot(file);
 *   if (blob) { // upload blob }
 *
 * Returns a JPEG Blob if the user confirmed, or null if they cancelled.
 */

import { mountModalTemplate } from "../modal-template";

const CROP_OUTPUT_SIZE = 1024; // px — square output

/**
 * Opens the image in a full-screen crop modal.
 * Resolves with a JPEG Blob on confirm, or null on cancel.
 */
export function cropHeadshot(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => showCropModal(img, resolve);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function showCropModal(img: HTMLImageElement, done: (blob: Blob | null) => void): void {
  // ── Get or create modal from template ──────────────────────────────────────
  const modal = mountModalTemplate(
    "crop-headshot-template",
    "crop-headshot-modal",
    "Crop headshot",
  );
  if (!modal) {
    done(null);
    return;
  }

  const overlay = modal.querySelector(".crop-headshot-overlay") as HTMLElement | null;
  const viewport = modal.querySelector(".crop-headshot-viewport") as HTMLElement | null;
  const imgEl = viewport?.querySelector("img") as HTMLImageElement | null;
  const slider = modal.querySelector(".crop-headshot-slider") as HTMLInputElement | null;
  const cancelBtn = modal.querySelector(".crop-headshot-cancel") as HTMLButtonElement | null;
  const confirmBtn = modal.querySelector(".crop-headshot-confirm") as HTMLButtonElement | null;

  if (!overlay || !viewport || !imgEl || !slider || !cancelBtn || !confirmBtn) {
    console.error("Crop headshot template is incomplete");
    modal.remove();
    done(null);
    return;
  }

  const modalEl = modal;
  const imageEl = imgEl;

  imgEl.src = img.src;
  modal.classList.add("active");

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
  let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  viewport.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    panStartX = panX; panStartY = panY;
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
  viewport.addEventListener("wheel", (e) => {
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
  }, { passive: false });

  // ── Event handlers ────────────────────────────────────────────────────────
  function dismiss(blob: Blob | null): void {
    modalEl.remove();
    done(blob);
  }

  cancelBtn.addEventListener("click", () => dismiss(null), { once: true });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(null); });

  confirmBtn.addEventListener("click", () => {
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

    canvas.toBlob((blob) => dismiss(blob), "image/jpeg", 0.92);
  }, { once: true });
}
