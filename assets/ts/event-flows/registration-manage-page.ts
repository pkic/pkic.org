import { getJson, patchJson, postJson } from "../shared/api-client";
import { setButtonLoading, resetButton } from "../shared/button-loading";
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
import { cropHeadshot } from "../shared/crop-headshot";
import { showManageLinkRecoveryForm } from "../shared/manage-link-recovery";
import { prepareHeadshotUploadBlob, showHeadshotDisclaimer } from "../shared/headshot-upload";
import { renderHeadshotPreview } from "../shared/headshot-preview";
import { bootstrap, setStatus } from "./boot";

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
    renderHeadshotPreview(preview, url, { alt: "Your headshot", emptyLabel: "No photo" });
    if (deleteBtn) deleteBtn.style.display = url ? "" : "none";
  }

  setPreview(initialHeadshotUrl);

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = "";

    void (async () => {
      const accepted = await showHeadshotDisclaimer();
      if (!accepted) return;

      const croppedBlob = await cropHeadshot(file);
      if (!croppedBlob) return;

      const uploadBlob = await prepareHeadshotUploadBlob(croppedBlob, 1024 * 1024);
      const uploadFile = new File([uploadBlob], "headshot.jpg", { type: "image/jpeg" });

      if (headshotStatus) headshotStatus.textContent = "Uploading…";
      const form = new FormData();
      form.append("file", uploadFile);
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

function attendanceTypeLabel(attendanceType: string): string {
  switch (attendanceType) {
    case "in_person":
      return "In-person attendance";
    case "virtual":
      return "Virtual attendance";
    case "on_demand":
      return "On-demand attendance";
    default:
      return attendanceType;
  }
}

function buildRegistrationStatusBanner(
  registrationStatus: string,
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>,
  dayWaitlist: Array<{ dayDate: string; status: string }>,
): string {
  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));
  const isRegistrationWaitlisted = registrationStatus === "waitlisted";

  const rows = dayAttendance.map((day) => {
    const dayLabel = day.label ?? day.dayDate;
    const attendanceLabel = attendanceTypeLabel(day.attendanceType);
    const waitlistStatus = waitlistByDay.get(day.dayDate);
    const confirmationLabel = waitlistStatus === "waiting" || waitlistStatus === "offered"
      ? "Waitlisted"
      : "Confirmed";
    const statusClass = waitlistStatus === "waiting" || waitlistStatus === "offered"
      ? "text-bg-warning"
      : "text-bg-success";

    return `<li class="d-flex flex-wrap align-items-center gap-2 mb-1"><span><strong>${dayLabel}:</strong> ${attendanceLabel}</span><span class="badge ${statusClass}">${confirmationLabel}</span></li>`;
  }).join("");

  const bannerLead = isRegistrationWaitlisted
    ? `<strong>Registration status:</strong> <span class="badge text-bg-warning">Waitlisted</span> Your registration is active, but one or more seats are still pending confirmation.`
    : `<strong>Registration status:</strong> <span class="badge text-bg-success">Confirmed</span> Your registration is active and confirmed.`;

  const daySummary = rows
    ? `<div class="mt-2"><div class="small text-uppercase fw-semibold text-muted mb-1">How you are attending each day</div><ul class="list-unstyled mb-0">${rows}</ul></div>`
    : "";

  const waitlistSummary = !isRegistrationWaitlisted && dayWaitlist.length > 0
    ? `<div class="mt-2 small">Some day-specific entries are still pending, so those days are marked <strong>waitlisted</strong> below.</div>`
    : "";

  return `${bannerLead}${daySummary}${waitlistSummary}`;
}

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

function showResendManageLinkForm(
  root: HTMLElement,
  apiBase: string,
  eventSlug: string,
  introMessage?: string,
): void {
  showManageLinkRecoveryForm({
    root,
    loadingSelector: "[data-manage-loading]",
    sectionSelector: "[data-resend-manage-section]",
    buttonSelector: "[data-resend-manage-btn]",
    statusSelector: "[data-resend-manage-status]",
    emailSelector: "[data-resend-manage-email]",
    endpoint: `${apiBase}/events/${eventSlug}/registrations/resend-manage-link`,
    successMessage: "If the details match a registration, you will receive an email shortly. Please check your inbox (and spam folder).",
    introMessage,
  });
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
    showResendManageLinkForm(root, apiBase, eventSlug);
    return;
  }

  // UI handles
  const loadingEl = root.querySelector<HTMLElement>("[data-manage-loading]");
  const statusBanner = root.querySelector<HTMLElement>("[data-manage-status-banner]");
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
    showResendManageLinkForm(
      root,
      apiBase,
      eventSlug,
      `${normalized.globalMessage} You can request a fresh management link below.`,
    );
    return;
  }

  const { registration, event, user, eventDays, dayAttendance, dayWaitlist } = manageData;
  const isCancelled = CANCELLED_STATUSES.has(registration.status);
  const eventName = event?.name ?? eventSlug;
  const firstName = user?.first_name ?? "";

  if (statusBanner) {
    if (registration.status === "waitlisted" || (dayWaitlist && dayWaitlist.length > 0)) {
      statusBanner.innerHTML = buildRegistrationStatusBanner(registration.status, dayAttendance, dayWaitlist ?? []);
      statusBanner.classList.remove("d-none");
    }
  }

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
    if (submitBtn) setButtonLoading(submitBtn);
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
      if (submitBtn) resetButton(submitBtn);
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
    if (yesBtn) setButtonLoading(yesBtn);
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
      if (yesBtn) resetButton(yesBtn);
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
    if (yesBtn) setButtonLoading(yesBtn);
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
      if (yesBtn) resetButton(yesBtn);
      if (noBtn) noBtn.disabled = false;
    }
  });
}

void main();
