/**
 * Shared headshot crop UI.
 *
 * Usage:
 *   const blob = await cropHeadshot(file);
 *   if (blob) { // upload blob }
 *
 * Returns a JPEG Blob if the user confirmed, or null if they cancelled.
 */

const CROP_OUTPUT_SIZE = 512; // px — square output

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
  // ── Overlay ───────────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);" +
    "display:flex;align-items:center;justify-content:center;flex-direction:column";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff;border-radius:12px;padding:24px;max-width:480px;width:90vw;" +
    "box-shadow:0 8px 32px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:16px";

  card.innerHTML = '<h6 class="mb-0">Crop headshot</h6>';

  // ── Circular viewport ─────────────────────────────────────────────────────
  const viewportSize = 300;
  const viewport = document.createElement("div");
  viewport.style.cssText =
    `width:${viewportSize}px;height:${viewportSize}px;border-radius:50%;overflow:hidden;` +
    "position:relative;cursor:grab;border:3px solid #198754;background:#eee;touch-action:none;flex-shrink:0";

  const imgEl = document.createElement("img");
  imgEl.src = img.src;
  imgEl.draggable = false;
  imgEl.style.cssText =
    "position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;pointer-events:none";

  viewport.appendChild(imgEl);
  card.appendChild(viewport);

  // ── Initial scale (cover) ─────────────────────────────────────────────────
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
    imgEl.style.width = `${naturalW * scale}px`;
    imgEl.style.height = `${naturalH * scale}px`;
    imgEl.style.left = `${panX}px`;
    imgEl.style.top = `${panY}px`;
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
    viewport.style.cursor = "grabbing";
    viewport.setPointerCapture(e.pointerId);
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
    viewport.style.cursor = "grab";
  });

  // ── Zoom slider ───────────────────────────────────────────────────────────
  const zoomRow = document.createElement("div");
  zoomRow.style.cssText = "display:flex;align-items:center;gap:8px;width:100%";
  zoomRow.innerHTML = '<span class="small text-muted">−</span>';

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(((fitScale - minScale) / (maxScale - minScale)) * 100);
  slider.className = "form-range";
  slider.style.flex = "1";
  zoomRow.appendChild(slider);

  const plusLabel = document.createElement("span");
  plusLabel.className = "small text-muted";
  plusLabel.textContent = "+";
  zoomRow.appendChild(plusLabel);
  card.appendChild(zoomRow);

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

  // ── Buttons ───────────────────────────────────────────────────────────────
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-sm btn-outline-secondary";
  cancelBtn.textContent = "Cancel";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-sm btn-success";
  confirmBtn.textContent = "Crop & Upload";

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ── Event handlers ────────────────────────────────────────────────────────
  function dismiss(blob: Blob | null): void {
    overlay.remove();
    done(blob);
  }

  cancelBtn.addEventListener("click", () => dismiss(null));
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
  });
}
