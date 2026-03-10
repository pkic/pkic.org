import { getJson, patchJson } from "../shared/api-client";
import type { EventFormsResponse, RegistrationManageResponse } from "../shared/types";
import { applyFieldErrors, normalizeValidation } from "../shared/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form-validation";
import {
  applyCustomFieldVisibility,
  readCustomFieldValues,
  renderCustomFields,
} from "../shared/render-custom-fields";
import { readDayAttendance, renderDayAttendance, writeDayAttendance } from "../shared/render-day-attendance";
import { renderSharePanel, refreshSharePanelBadge } from "../shared/render-share-panel";
import { bootstrap, setStatus } from "./boot";

// ── Headshot disclaimer ─────────────────────────────────────────────────────

const HEADSHOT_DISCLAIMER_TEXT = [
  "This is a photograph of myself.",
  "I hold the copyright to this image, or I have an unrestricted, royalty-free licence to use and publish it.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "I grant PKI Consortium a non-exclusive, worldwide licence to display this image alongside my name and professional details on this website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

function showHeadshotDisclaimer(): Promise<boolean> {
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

// ── Headshot cropper ─────────────────────────────────────────────────────────

/**
 * Opens a canvas-based crop modal.  The user can drag to reposition the image
 * and zoom via a slider.  Resolves with a square 600 × 600 PNG File, or null
 * if the user cancels.
 */
function showHeadshotCropper(file: File): Promise<File | null> {
  const CROP_PX  = 280;  // visible crop-circle diameter (CSS px)
  const OUTPUT_PX = 1200; // exported PNG dimension — large enough for livestream / slide use

  return new Promise((resolve) => {
    // ── Shell ──────────────────────────────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9100;display:flex;" +
      "align-items:center;justify-content:center;padding:1rem;overflow-y:auto";

    const card = document.createElement("div");
    card.style.cssText =
      "background:#fff;border-radius:.5rem;max-width:380px;width:100%;padding:1.25rem;" +
      "box-shadow:0 8px 32px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:.75rem";
    card.innerHTML = `
      <h4 style="margin:0;font-size:1rem">Crop your photo</h4>
      <p style="margin:0;font-size:.8rem;color:#6c757d">
        Drag the image to reposition it inside the circle. Use the slider to zoom.
      </p>
      <div data-crop-wrap
        style="position:relative;width:${CROP_PX}px;height:${CROP_PX}px;margin:0 auto;
               border-radius:50%;overflow:hidden;border:2px solid #dee2e6;
               cursor:grab;touch-action:none;flex-shrink:0;background:#f8f9fa">
        <canvas data-crop-canvas width="${CROP_PX}" height="${CROP_PX}" style="display:block"></canvas>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="font-size:1rem;line-height:1;user-select:none">&#x2212;</span>
        <input type="range" data-crop-zoom min="100" max="300" value="100" step="1" style="flex:1">
        <span style="font-size:1rem;line-height:1;user-select:none">+</span>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button type="button" data-crop-cancel class="btn btn-outline-secondary btn-sm">Cancel</button>
        <button type="button" data-crop-confirm class="btn btn-success btn-sm">Use this crop</button>
      </div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const canvas    = card.querySelector<HTMLCanvasElement>("[data-crop-canvas]")!;
    const ctx       = canvas.getContext("2d")!;
    const zoomSlider = card.querySelector<HTMLInputElement>("[data-crop-zoom]")!;
    const cancelBtn = card.querySelector<HTMLButtonElement>("[data-crop-cancel]")!;
    const confirmBtn = card.querySelector<HTMLButtonElement>("[data-crop-confirm]")!;
    const wrap      = card.querySelector<HTMLElement>("[data-crop-wrap]")!;

    const img = new Image();
    let scale = 1;  // current zoom (1 = short-side fills CROP_PX)
    let ox = 0;     // image draw origin x within canvas
    let oy = 0;     // image draw origin y within canvas
    let imgW = 0;   // image display width at scale 1
    let imgH = 0;   // image display height at scale 1

    function draw(): void {
      ctx.clearRect(0, 0, CROP_PX, CROP_PX);
      ctx.drawImage(img, ox, oy, imgW * scale, imgH * scale);
    }

    // Ensure the image always covers the full circle
    function clamp(): void {
      const w = imgW * scale;
      const h = imgH * scale;
      if (ox > 0) ox = 0;
      if (oy > 0) oy = 0;
      if (ox + w < CROP_PX) ox = CROP_PX - w;
      if (oy + h < CROP_PX) oy = CROP_PX - h;
    }

    img.onload = () => {
      // Scale so the shorter side exactly covers CROP_PX
      const r = img.naturalWidth / img.naturalHeight;
      if (r >= 1) { imgH = CROP_PX; imgW = CROP_PX * r; }
      else         { imgW = CROP_PX; imgH = CROP_PX / r; }
      scale = 1;
      ox = (CROP_PX - imgW) / 2;
      oy = (CROP_PX - imgH) / 2;
      clamp();
      draw();
    };
    img.src = URL.createObjectURL(file);

    // ── Zoom slider ────────────────────────────────────────────────────────
    zoomSlider.addEventListener("input", () => {
      const newScale = Number(zoomSlider.value) / 100;
      // Keep the crop centre fixed during zoom
      const cx = CROP_PX / 2, cy = CROP_PX / 2;
      ox = cx - (cx - ox) * (newScale / scale);
      oy = cy - (cy - oy) * (newScale / scale);
      scale = newScale;
      clamp();
      draw();
    });

    // ── Drag (mouse + touch via Pointer Events) ────────────────────────────
    let dragging = false, lastX = 0, lastY = 0;
    wrap.addEventListener("pointerdown", (e: PointerEvent) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      wrap.style.cursor = "grabbing";
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      ox += e.clientX - lastX; oy += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      clamp(); draw();
    });
    const endDrag = (): void => { dragging = false; wrap.style.cursor = "grab"; };
    wrap.addEventListener("pointerup",     endDrag);
    wrap.addEventListener("pointercancel", endDrag);

    // ── Confirm: render to offscreen canvas and export JPEG ──────────────────
    confirmBtn.addEventListener("click", () => {
      // Never upscale beyond the source — use min of desired max and natural size.
      const naturalMin = Math.min(img.naturalWidth, img.naturalHeight);
      const outPx = Math.min(OUTPUT_PX, naturalMin);
      const off = Object.assign(document.createElement("canvas"),
        { width: outPx, height: outPx });
      const offCtx = off.getContext("2d")!;
      const ratio = outPx / CROP_PX;
      offCtx.drawImage(img, ox * ratio, oy * ratio, imgW * scale * ratio, imgH * scale * ratio);
      // JPEG at 0.92 quality: photos are 100–400 KB vs several MB for PNG.
      off.toBlob((blob) => {
        overlay.remove();
        URL.revokeObjectURL(img.src);
        resolve(blob ? new File([blob], "headshot.jpg", { type: "image/jpeg" }) : null);
      }, "image/jpeg", 0.92);
    });

    // ── Cancel ─────────────────────────────────────────────────────────────
    cancelBtn.addEventListener("click", () => {
      overlay.remove(); URL.revokeObjectURL(img.src); resolve(null);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { overlay.remove(); URL.revokeObjectURL(img.src); resolve(null); }
    });
  });
}

// ── Headshot section wiring ──────────────────────────────────────────────────

function wireHeadshotSection(
  root: HTMLElement,
  token: string,
  apiBase: string,
  initialHeadshotUrl: string | null | undefined,
  statusEl: HTMLElement,
  onChanged?: () => void,
): void {
  const section = root.querySelector<HTMLElement>("[data-headshot-section]");
  if (!section) return;

  const preview = section.querySelector<HTMLElement>("[data-headshot-preview]");
  const headshotStatus = section.querySelector<HTMLElement>("[data-headshot-status]");
  const fileInput = section.querySelector<HTMLInputElement>("[data-headshot-file]");
  const deleteBtn = section.querySelector<HTMLButtonElement>("[data-headshot-delete]");

  function setPreview(url: string | null | undefined): void {
    if (!preview) return;
    if (url) {
      preview.innerHTML = `<img src="${url}" alt="Your headshot" style="width:80px;height:80px;object-fit:cover;border-radius:50%;border:2px solid #dee2e6">`;
      if (deleteBtn) deleteBtn.style.display = "";
    } else {
      preview.innerHTML = `<div style="width:80px;height:80px;border-radius:50%;border:2px dashed #dee2e6;display:flex;align-items:center;justify-content:center;color:#adb5bd;font-size:.75rem">No photo</div>`;
      if (deleteBtn) deleteBtn.style.display = "none";
    }
  }

  setPreview(initialHeadshotUrl);

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = "";

    const MAX_RAW_MB = 1;
    if (file.size > MAX_RAW_MB * 1024 * 1024) {
      if (headshotStatus) headshotStatus.textContent = `Please choose an image under ${MAX_RAW_MB} MB.`;
      return;
    }

    void (async () => {
      const accepted = await showHeadshotDisclaimer();
      if (!accepted) return;

      const croppedFile = await showHeadshotCropper(file);
      if (!croppedFile) return;

      if (headshotStatus) headshotStatus.textContent = "Uploading…";
      const form = new FormData();
      form.append("file", croppedFile);
      form.append("consent", "true");

      try {
        const res = await fetch(`${apiBase}/registrations/manage/${encodeURIComponent(token)}/headshot`, {
          method: "PUT",
          body: form,
        });
        const data = await res.json() as { success?: boolean; headshotUrl?: string; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
        if (headshotStatus) headshotStatus.textContent = "Photo updated. Your social badge is regenerating…";
        setPreview(data.headshotUrl);
        onChanged?.();
      } catch (err) {
        const msg = (err as Error).message;
        if (headshotStatus) headshotStatus.textContent = `Upload failed: ${msg}`;
        setStatus(statusEl, `Failed to upload headshot: ${msg}`, true);
      }
    })();
  });

  deleteBtn?.addEventListener("click", () => {
    if (!confirm("Remove your profile photo?")) return;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/registrations/manage/${encodeURIComponent(token)}/headshot`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const d = await res.json() as { error?: { message?: string } };
          throw new Error(d.error?.message ?? `HTTP ${res.status}`);
        }
        if (headshotStatus) headshotStatus.textContent = "Photo removed. Your social badge has been updated.";
        setPreview(null);
        onChanged?.();
      } catch (err) {
        setStatus(statusEl, `Failed to remove headshot: ${(err as Error).message}`, true);
      }
    })();
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function setInputValue(form: HTMLFormElement, name: string, value: string | null | undefined): void {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value ?? "";
  }
}

/**
 * Pre-fills custom field inputs from the saved custom_answers object.
 * Handles text, textarea, select, checkbox, and radio inputs.
 */
function writeCustomFieldValues(form: HTMLFormElement, answers: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(answers)) {
    if (Array.isArray(value)) {
      // Checkbox groups: name="custom.foo[]" or multi-select
      const checkboxes = form.querySelectorAll<HTMLInputElement>(
        `input[type='checkbox'][name='custom.${key}[]']`,
      );
      if (checkboxes.length > 0) {
        const strValues = value.map(String);
        for (const cb of Array.from(checkboxes)) {
          cb.checked = strValues.includes(cb.value);
        }
        continue;
      }
      const select = form.querySelector<HTMLSelectElement>(`select[name='custom.${key}'][multiple]`);
      if (select) {
        const strValues = value.map(String);
        for (const option of Array.from(select.options)) {
          option.selected = strValues.includes(option.value);
        }
        continue;
      }
    }
    if (typeof value === "object" && value !== null && "start" in value && "end" in value) {
      const startEl = form.querySelector<HTMLInputElement>(`input[name='custom.${key}.start']`);
      const endEl = form.querySelector<HTMLInputElement>(`input[name='custom.${key}.end']`);
      if (startEl) startEl.value = String((value as Record<string, unknown>).start ?? "");
      if (endEl) endEl.value = String((value as Record<string, unknown>).end ?? "");
      continue;
    }
    if (typeof value === "boolean") {
      const checkbox = form.querySelector<HTMLInputElement>(`input[type='checkbox'][name='custom.${key}']`);
      if (checkbox) {
        checkbox.checked = value;
        continue;
      }
    }
    const el = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name='custom.${key}']`,
    );
    if (el) {
      el.value = String(value ?? "");
    }
  }
}

function deriveEventAttendanceType(
  values: Array<{ attendanceType: string }>,
): "in_person" | "virtual" | "on_demand" | undefined {
  if (values.some((v) => v.attendanceType === "in_person")) return "in_person";
  if (values.some((v) => v.attendanceType === "virtual")) return "virtual";
  if (values.length > 0) return "on_demand";
  return undefined;
}

const CANCELLED_STATUSES = new Set(["cancelled", "cancelled_unauthorized"]);

function statusLabel(status: string): { label: string; cssClass: string } {
  switch (status) {
    case "registered":
      return { label: "Confirmed", cssClass: "bg-success" };
    case "waitlisted":
      return { label: "Waitlisted", cssClass: "bg-warning text-dark" };
    case "pending_email_confirmation":
      return { label: "Pending confirmation", cssClass: "bg-secondary" };
    case "cancelled":
      return { label: "Cancelled", cssClass: "bg-danger" };
    case "cancelled_unauthorized":
      return { label: "Cancelled (unauthorized)", cssClass: "bg-danger" };
    default:
      return { label: status, cssClass: "bg-secondary" };
  }
}

function showPostAction(
  root: HTMLElement,
  manageFormEl: HTMLElement,
  opts: { title: string; message: string; isError?: boolean },
): void {
  manageFormEl.classList.add("d-none");
  const postAction = root.querySelector<HTMLElement>("[data-post-action]");
  const alertEl = root.querySelector<HTMLElement>("[data-post-action-alert]");
  const titleEl = root.querySelector<HTMLElement>("[data-post-action-title]");
  const msgEl = root.querySelector<HTMLElement>("[data-post-action-message]");
  if (!postAction || !alertEl || !titleEl || !msgEl) return;
  titleEl.textContent = opts.title;
  msgEl.textContent = opts.message;
  alertEl.classList.remove("alert-success", "alert-warning", "alert-danger");
  alertEl.classList.add(opts.isError ? "alert-danger" : "alert-success");
  postAction.classList.remove("d-none");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-registration-manage]");
  if (!boot) return;

  const { form, statusEl, eventSlug, apiBase, query, root } = boot;
  installLiveValidation(form, statusEl);

  const token: string | null = (root as HTMLElement & { dataset: DOMStringMap }).dataset.manageToken?.trim()
    ?? query.token
    ?? null;

  if (!token) {
    const loadingEl = root.querySelector<HTMLElement>("[data-manage-loading]");
    if (loadingEl) loadingEl.textContent = "Missing registration token. Please open this page from your confirmation email.";
    return;
  }

  // UI handles
  const loadingEl = root.querySelector<HTMLElement>("[data-manage-loading]");
  const manageFormEl = root.querySelector<HTMLElement>("[data-manage-form]");
  const greetingEl = root.querySelector<HTMLElement>("[data-manage-greeting]");
  const greetingText = root.querySelector<HTMLElement>("[data-manage-greeting-text]");
  const statusBadge = root.querySelector<HTMLElement>("[data-manage-status-badge]");
  const dayAttendanceContainer = root.querySelector<HTMLElement>("[data-day-attendance]");
  const dayWaitlistContainer = root.querySelector<HTMLElement>("[data-day-waitlist]");
  const dayWaitlistSection = root.querySelector<HTMLElement>("[data-day-waitlist-section]");
  const customFieldsContainer = root.querySelector<HTMLElement>("[data-custom-fields]");
  const customFieldsSection = root.querySelector<HTMLElement>("[data-custom-fields-section]");
  const actionButtons = root.querySelector<HTMLElement>("[data-action-buttons]");
  const cancelConfirmPanel = root.querySelector<HTMLElement>("[data-confirm-cancel]");
  const cancelEventNameEl = root.querySelector<HTMLElement>("[data-confirm-event-name]");
  const unauthorizedPanel = root.querySelector<HTMLElement>("[data-confirm-unauthorized]");

  // ── Load data (manage API + forms API in parallel) ───────────────────────
  let manageData: RegistrationManageResponse;
  let formsData: EventFormsResponse | null = null;

  try {
    [manageData, formsData] = await Promise.all([
      getJson<RegistrationManageResponse>(`${apiBase}/registrations/manage/${encodeURIComponent(token)}`),
      getJson<EventFormsResponse>(`${apiBase}/events/${eventSlug}/forms?purpose=event_registration`).catch(() => null),
    ]);
  } catch (error) {
    const normalized = normalizeValidation(error);
    if (loadingEl) loadingEl.textContent = normalized.globalMessage;
    return;
  }

  const { registration, event, user, eventDays, dayAttendance, dayWaitlist } = manageData;
  const isCancelled = CANCELLED_STATUSES.has(registration.status);
  const eventName = event?.name ?? eventSlug;
  const firstName = user?.first_name ?? "";

  // ── Greeting ──────────────────────────────────────────────────────────────
  if (greetingEl && greetingText && statusBadge) {
    greetingText.textContent = firstName
      ? `Hi ${firstName}, we're looking forward to seeing you at ${eventName}!`
      : `Your registration for ${eventName}`;
    const { label, cssClass } = statusLabel(registration.status);
    statusBadge.textContent = label;
    statusBadge.className = `badge ${cssClass}`;
    greetingEl.classList.remove("d-none");
  }

  // ── Pre-fill personal details ─────────────────────────────────────────────
  setInputValue(form, "firstName", user?.first_name);
  setInputValue(form, "lastName", user?.last_name);
  setInputValue(form, "organizationName", user?.organization_name);
  setInputValue(form, "jobTitle", user?.job_title);

  // ── Custom event questions (same pipeline as registration-page.ts) ────────
  let customFieldsRendered = false;
  if (customFieldsContainer && formsData?.form?.fields && formsData.form.fields.length > 0) {
    renderCustomFields(customFieldsContainer, formsData.form.fields);
    customFieldsRendered = true;
    if (registration.custom_answers) {
      writeCustomFieldValues(form, registration.custom_answers as Record<string, unknown>);
    }
    // Apply visibility rules based on current day attendance selections.
    const currentDayAttendance = dayAttendance.map((d) => ({ attendanceType: d.attendanceType }));
    applyCustomFieldVisibility(customFieldsContainer, {
      dayAttendance: currentDayAttendance,
      eventAttendanceType: deriveEventAttendanceType(currentDayAttendance),
    });
  } else if (customFieldsSection) {
    // Hide the section entirely when there are no event-specific questions.
    customFieldsSection.classList.add("d-none");
  }

  // ── Day attendance ────────────────────────────────────────────────────────
  if (dayAttendanceContainer) {
    renderDayAttendance(dayAttendanceContainer, eventDays);
    writeDayAttendance(form, dayAttendance);
  }

  // ── Day waitlist (only shown when there are active entries) ──────────────
  if (dayWaitlistContainer && dayWaitlistSection) {
    if (dayWaitlist && dayWaitlist.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "event-flow-day-waitlist d-flex flex-wrap gap-2";
      for (const entry of dayWaitlist) {
        const badge = document.createElement("span");
        const expiry = entry.offerExpiresAt
          ? `, offer expires ${new Date(entry.offerExpiresAt).toLocaleString()}`
          : "";
        badge.className = `badge text-bg-${entry.status === "offered" ? "warning" : entry.status === "accepted" ? "success" : "secondary"}`;
        badge.textContent = `${entry.dayDate}: ${entry.status} (${entry.priorityLane}${expiry})`;
        wrap.append(badge);
      }
      dayWaitlistContainer.append(wrap);
      dayWaitlistSection.classList.remove("d-none");
    }
  }

  // ── Lock the form if already cancelled ───────────────────────────────────
  if (isCancelled && actionButtons) {
    const allButtons = actionButtons.querySelectorAll<HTMLButtonElement>("button");
    for (const btn of Array.from(allButtons)) {
      btn.disabled = true;
    }
    const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    );
    for (const field of Array.from(fields)) {
      field.disabled = true;
    }
    setStatus(statusEl, "This registration has been cancelled and can no longer be edited.", true);
  }

  // ── Show the form ─────────────────────────────────────────────────────────
  if (loadingEl) loadingEl.classList.add("d-none");
  if (manageFormEl) manageFormEl.classList.remove("d-none");

  // ── Share panel ───────────────────────────────────────────────────────────
  const sharePanelEl = root.querySelector<HTMLElement>("[data-manage-share]");
  if (sharePanelEl && manageData.shareUrl) {
    renderSharePanel(sharePanelEl, {
      shareUrl: manageData.shareUrl,
      eventName,
      firstName,
      lastName: user?.last_name ?? undefined,
      manageToken: manageData.manageToken ?? token,
      eventSlug,
    });
  }

  // ── Headshot section ──────────────────────────────────────────────────────
  if (!isCancelled) {
    wireHeadshotSection(root, token, apiBase, manageData.headshotUrl, statusEl, () => {
      if (sharePanelEl) refreshSharePanelBadge(sharePanelEl);
    });
  } else {
    const headshotSection = root.querySelector<HTMLElement>("[data-headshot-section]");
    if (headshotSection) headshotSection.style.display = "none";
  }

  // Re-apply custom field visibility when day attendance changes.
  if (customFieldsContainer) {
    form.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || !target.name.startsWith("dayAttendance.")) return;
      const currentDayAttendance = readDayAttendance(form);
      applyCustomFieldVisibility(customFieldsContainer, {
        dayAttendance: currentDayAttendance,
        eventAttendanceType: deriveEventAttendanceType(currentDayAttendance),
      });
    });
  }

  // ── Save changes (update) ─────────────────────────────────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isCancelled) return;
    form.classList.add("was-validated");
    if (!validateBeforeSubmit(form, statusEl)) return;

    const submitBtn = form.querySelector<HTMLButtonElement>("button[type='submit']");
    const cancelBtn = form.querySelector<HTMLButtonElement>("[data-action='cancel']");
    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      const dayAttendancePayload = readDayAttendance(form);
      await patchJson<{ success: boolean }>(
        `${apiBase}/registrations/manage/${encodeURIComponent(token)}`,
        {
          action: "update",
          attendanceType: dayAttendancePayload.length === 0
            ? (registration.attendance_type as "in_person" | "virtual" | "on_demand")
            : undefined,
          dayAttendance: dayAttendancePayload,
          // Only include customAnswers when the fields were actually rendered —
          // sending an empty {} would fail backend required-field validation
          // and wipe any previously saved answers.
          customAnswers: customFieldsRendered ? readCustomFieldValues(form) : undefined,
          firstName: (form.elements.namedItem("firstName") as HTMLInputElement | null)?.value.trim() || undefined,
          lastName: (form.elements.namedItem("lastName") as HTMLInputElement | null)?.value.trim() || undefined,
          organizationName: (form.elements.namedItem("organizationName") as HTMLInputElement | null)?.value.trim() || undefined,
          jobTitle: (form.elements.namedItem("jobTitle") as HTMLInputElement | null)?.value.trim() || undefined,
        },
      );
      if (manageFormEl) {
        showPostAction(root, manageFormEl, {
          title: "Changes saved",
          message: "Your registration details have been updated. A confirmation email is on its way.",
        });
      }
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(statusEl, normalized.globalMessage, true);
      applyFieldErrors(form, normalized.fields);
      if (submitBtn) submitBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });

  // ── Cancel flow ───────────────────────────────────────────────────────────
  const cancelBtn = root.querySelector<HTMLButtonElement>("[data-action='cancel']");
  cancelBtn?.addEventListener("click", () => {
    if (isCancelled) return;
    if (cancelEventNameEl) cancelEventNameEl.textContent = eventName;
    if (manageFormEl) manageFormEl.classList.add("d-none");
    cancelConfirmPanel?.classList.remove("d-none");
  });

  root.querySelector<HTMLButtonElement>("[data-confirm-cancel-no]")?.addEventListener("click", () => {
    cancelConfirmPanel?.classList.add("d-none");
    if (manageFormEl) manageFormEl.classList.remove("d-none");
  });

  root.querySelector<HTMLButtonElement>("[data-confirm-cancel-yes]")?.addEventListener("click", async () => {
    const yesBtn = root.querySelector<HTMLButtonElement>("[data-confirm-cancel-yes]");
    const noBtn = root.querySelector<HTMLButtonElement>("[data-confirm-cancel-no]");
    if (yesBtn) yesBtn.disabled = true;
    if (noBtn) noBtn.disabled = true;

    try {
      await patchJson<{ success: boolean }>(
        `${apiBase}/registrations/manage/${encodeURIComponent(token)}`,
        { action: "cancel" },
      );
      cancelConfirmPanel?.classList.add("d-none");
      if (manageFormEl) {
        showPostAction(root, manageFormEl, {
          title: "Registration cancelled",
          message:
            "Your registration has been cancelled. You can re-register at any time if you change your mind.",
        });
      }
    } catch (error) {
      const normalized = normalizeValidation(error);
      cancelConfirmPanel?.classList.add("d-none");
      if (manageFormEl) manageFormEl.classList.remove("d-none");
      setStatus(statusEl, normalized.globalMessage, true);
      if (yesBtn) yesBtn.disabled = false;
      if (noBtn) noBtn.disabled = false;
    }
  });

  // ── Report unauthorized flow ──────────────────────────────────────────────
  root.querySelector<HTMLButtonElement>("[data-action='report-unauthorized']")?.addEventListener("click", () => {
    if (isCancelled) return;
    if (manageFormEl) manageFormEl.classList.add("d-none");
    unauthorizedPanel?.classList.remove("d-none");
  });

  root.querySelector<HTMLButtonElement>("[data-unauthorized-no]")?.addEventListener("click", () => {
    unauthorizedPanel?.classList.add("d-none");
    if (manageFormEl) manageFormEl.classList.remove("d-none");
  });

  root.querySelector<HTMLButtonElement>("[data-unauthorized-yes]")?.addEventListener("click", async () => {
    const yesBtn = root.querySelector<HTMLButtonElement>("[data-unauthorized-yes]");
    const noBtn = root.querySelector<HTMLButtonElement>("[data-unauthorized-no]");
    if (yesBtn) yesBtn.disabled = true;
    if (noBtn) noBtn.disabled = true;

    try {
      await patchJson<{ success: boolean }>(
        `${apiBase}/registrations/manage/${encodeURIComponent(token)}`,
        { action: "report_unauthorized" },
      );
      unauthorizedPanel?.classList.add("d-none");
      if (manageFormEl) {
        showPostAction(root, manageFormEl, {
          title: "Report received",
          message:
            "Your registration has been cancelled and your event-specific data removed. " +
            "The organizer has been notified and will review for potential misuse.",
        });
      }
    } catch (error) {
      const normalized = normalizeValidation(error);
      unauthorizedPanel?.classList.add("d-none");
      if (manageFormEl) manageFormEl.classList.remove("d-none");
      setStatus(statusEl, normalized.globalMessage, true);
      if (yesBtn) yesBtn.disabled = false;
      if (noBtn) noBtn.disabled = false;
    }
  });
}

void main();
