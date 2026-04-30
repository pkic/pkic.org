import { render } from "preact";
import { getJson, patchJson } from "../shared/api-client";
import type { EventFormsResponse, RegistrationManageResponse } from "../shared/types";
import { normalizeValidation } from "../shared/form/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import {
  readCustomFieldValues,
  renderCustomFields,
  type CustomFieldsController,
} from "../shared/widgets/custom-fields";
import { readDayAttendance, renderDayAttendance, writeDayAttendance } from "../shared/widgets/day-attendance";
import { renderSharePanel, refreshSharePanelBadge } from "../shared/widgets/share-panel";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { wireHeadshotSection } from "./registration-manage-headshot";
import { registrationManageSchema } from "../../shared/schemas/api";
import { buildManageLinkRecoveryMessage, showPostAction, showResendManageLinkForm } from "./registration-manage-panels";
import { setField, deriveEventAttendanceType, findSubmitButton } from "../shared/form/helpers";

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

function isPendingDayWaitlistStatus(status: string | undefined): boolean {
  return status === "waiting" || status === "offered";
}

function RegistrationStatusBanner({
  registrationStatus,
  dayAttendance,
  dayWaitlist,
}: {
  registrationStatus: string;
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist: Array<{ dayDate: string; status: string }>;
}) {
  const activeDayWaitlist = dayWaitlist.filter((entry) => isPendingDayWaitlistStatus(entry.status));
  const waitlistByDay = new Map(activeDayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));
  const isRegistrationWaitlisted = registrationStatus === "waitlisted";

  return (
    <>
      <strong>Registration status:</strong>{" "}
      {isRegistrationWaitlisted ? (
        <>
          <span class="badge text-bg-warning">Waitlisted</span> Your registration is active, but one or more seats are
          still pending confirmation.
        </>
      ) : (
        <>
          <span class="badge text-bg-success">Confirmed</span> Your registration is active and confirmed.
        </>
      )}
      {dayAttendance.length > 0 && (
        <div class="mt-2">
          <div class="small text-uppercase fw-semibold text-muted mb-1">How you are attending each day</div>
          <ul class="list-unstyled mb-0">
            {dayAttendance.map((day) => {
              const dayLabel = day.label ?? day.dayDate;
              const attLabel = attendanceTypeLabel(day.attendanceType);
              const waitlistStatus = waitlistByDay.get(day.dayDate);
              const confirmationLabel =
                waitlistStatus === "waiting" || waitlistStatus === "offered" ? "Waitlisted" : "Confirmed";
              const statusClass =
                waitlistStatus === "waiting" || waitlistStatus === "offered" ? "text-bg-warning" : "text-bg-success";
              return (
                <li key={day.dayDate} class="d-flex flex-wrap align-items-center gap-2 mb-1">
                  <span>
                    <strong>{dayLabel}:</strong> {attLabel}
                  </span>
                  <span class={`badge ${statusClass}`}>{confirmationLabel}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!isRegistrationWaitlisted && dayWaitlist.length > 0 && (
        <div class="mt-2 small">
          Some day-specific entries are still pending, so those days are marked <strong>waitlisted</strong> below. If
          that no longer works for you, update the selections below or cancel the registration.
        </div>
      )}
    </>
  );
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-registration-manage]");
  if (!boot) return;

  const { form, statusEl, eventSlug, apiBase, query, root } = boot;
  installLiveValidation(form, statusEl);

  const token: string | null =
    (root as HTMLElement & { dataset: DOMStringMap }).dataset.manageToken?.trim() ?? query.token ?? null;

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
  let formsData: EventFormsResponse | null;

  try {
    [manageData, formsData] = await Promise.all([
      getJson<RegistrationManageResponse>(`${apiBase}/registrations/manage/${encodeURIComponent(token)}`),
      getJson<EventFormsResponse>(`${apiBase}/events/${eventSlug}/forms?purpose=event_registration`).catch(() => null),
    ]);
  } catch (error) {
    const normalized = normalizeValidation(error);
    showResendManageLinkForm(root, apiBase, eventSlug, buildManageLinkRecoveryMessage(normalized.globalMessage));
    return;
  }

  const { registration, event, user, eventDays, dayAttendance, dayWaitlist } = manageData;
  const isCancelled = CANCELLED_STATUSES.has(registration.status);
  const eventName = event?.name ?? eventSlug;
  const firstName = user?.first_name ?? "";

  if (statusBanner) {
    const activeDayWaitlist = (dayWaitlist ?? []).filter((entry) => isPendingDayWaitlistStatus(entry.status));
    if (registration.status === "waitlisted" || activeDayWaitlist.length > 0) {
      render(
        <RegistrationStatusBanner
          registrationStatus={registration.status}
          dayAttendance={dayAttendance}
          dayWaitlist={dayWaitlist ?? []}
        />,
        statusBanner,
      );
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
  setField(form, "email", user?.email);
  setField(form, "firstName", user?.first_name);
  setField(form, "lastName", user?.last_name);
  setField(form, "organizationName", user?.organization_name);
  setField(form, "jobTitle", user?.job_title);

  // ── Email change notice ───────────────────────────────────────────────────
  const originalEmail = user?.email?.toLowerCase() ?? "";
  const emailChangeNotice = root.querySelector<HTMLElement>("[data-email-change-notice]");
  const emailInput = form.elements.namedItem("email") as HTMLInputElement | null;
  if (emailInput && emailChangeNotice) {
    emailInput.addEventListener("input", () => {
      const changed = emailInput.value.trim().toLowerCase() !== originalEmail;
      emailChangeNotice.classList.toggle("d-none", !changed);
    });
  }

  // ── Custom event questions (same pipeline as registration-page.ts) ────────
  let customFieldsRendered = false;
  let customFields: CustomFieldsController | null = null;
  if (customFieldsContainer && formsData?.form?.fields && formsData.form.fields.length > 0) {
    customFields = renderCustomFields(customFieldsContainer, formsData.form.fields);
    customFieldsRendered = true;
    if (registration.custom_answers) {
      customFields.setValues(registration.custom_answers);
    }
    // Apply visibility rules based on current day attendance selections.
    const currentDayAttendance = dayAttendance.map((d) => ({ attendanceType: d.attendanceType }));
    customFields.updateVisibility({
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
    const activeDayWaitlist = (dayWaitlist ?? []).filter((entry) => isPendingDayWaitlistStatus(entry.status));
    const labelByDayDate = new Map(eventDays.map((day) => [day.dayDate, day.label ?? day.dayDate] as const));
    if (activeDayWaitlist.length > 0) {
      render(
        <div class="event-flow-day-waitlist d-flex flex-wrap gap-2">
          {activeDayWaitlist.map((entry) => {
            const expiry = entry.offerExpiresAt
              ? `, offer expires ${new Date(entry.offerExpiresAt).toLocaleString()}`
              : "";
            const dayLabel = labelByDayDate.get(entry.dayDate) ?? entry.dayDate;
            const statusText = entry.status === "offered" ? "In-person spot available" : "Waiting for in-person seat";
            return (
              <span
                key={entry.dayDate}
                class={`badge text-bg-${entry.status === "offered" ? "warning" : entry.status === "accepted" ? "success" : "secondary"}`}
              >
                {dayLabel}: {statusText} ({entry.priorityLane}
                {expiry})
              </span>
            );
          })}
        </div>,
        dayWaitlistContainer,
      );
      dayWaitlistSection.classList.remove("d-none");
    }
  }

  // ── Lock the form if cancelled ──
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

    // Show different message and options based on email verification status
    const isEmailVerified = manageData.registration.isEmailVerified;
    if (isEmailVerified) {
      // Email verified but registration cancelled for other reason → offer simple restore
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-primary mt-2";
      restoreBtn.textContent = "Restore Registration";
      let restoring = false;
      restoreBtn.onclick = async (e) => {
        e.preventDefault();
        if (restoring) return;
        restoring = true;
        restoreBtn.disabled = true;
        try {
          await patchJson(`/api/v1/registrations/manage/${encodeURIComponent(token)}`, { action: "update" });
          if (manageFormEl) {
            showPostAction(root, manageFormEl, {
              title: "Registration Restored",
              message: "Your registration has been successfully restored. You will be redirected momentarily.",
            });
          }
          setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
          if (manageFormEl) {
            showPostAction(root, manageFormEl, {
              title: "Restore Failed",
              message: (error as Error).message,
              isError: true,
            });
          }
          restoring = false;
          restoreBtn.disabled = false;
        }
      };
      statusEl?.parentElement?.insertBefore(restoreBtn, statusEl?.nextSibling);
      setStatus(statusEl, "This registration has been cancelled. Your email address is verified.", true);
    } else {
      // Email not verified → allow user to correct it
      const emailInput = form.querySelector<HTMLInputElement>("input[name='email']");
      if (emailInput) {
        emailInput.disabled = false;
      }
      setStatus(
        statusEl,
        "This registration has been cancelled because your email address could not be verified. Please check or correct your email address and try again to restore your registration.",
        true,
      );
    }
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
    headshotSection?.classList.add("d-none");
  }

  // Re-apply custom field visibility when day attendance changes.
  if (customFields) {
    const ctrl = customFields;
    form.addEventListener("change", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || !target.name.startsWith("dayAttendance.")) return;
      const currentDayAttendance = readDayAttendance(form);
      ctrl.updateVisibility({
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

    const submitBtn = findSubmitButton(form);
    const cancelBtn = form.querySelector<HTMLButtonElement>("[data-action='cancel']");
    if (cancelBtn) cancelBtn.disabled = true;

    await withLoadingButton(submitBtn, async () => {
      try {
        const dayAttendancePayload = readDayAttendance(form);
        const emailValue = (form.elements.namedItem("email") as HTMLInputElement | null)?.value.trim() || undefined;
        const emailIsChanged = emailValue && emailValue.toLowerCase() !== originalEmail;
        const result = await patchJson<{ success: boolean; emailChanged?: boolean }>(
          `${apiBase}/registrations/manage/${encodeURIComponent(token)}`,
          registrationManageSchema.parse({
            action: "update",
            attendanceType:
              dayAttendancePayload.length === 0
                ? (registration.attendance_type as "in_person" | "virtual" | "on_demand")
                : undefined,
            dayAttendance: dayAttendancePayload,
            customAnswers: customFieldsRendered ? readCustomFieldValues(form) : undefined,
            email: emailIsChanged ? emailValue : undefined,
            firstName: (form.elements.namedItem("firstName") as HTMLInputElement | null)?.value.trim() || undefined,
            lastName: (form.elements.namedItem("lastName") as HTMLInputElement | null)?.value.trim() || undefined,
            organizationName:
              (form.elements.namedItem("organizationName") as HTMLInputElement | null)?.value.trim() || undefined,
            jobTitle: (form.elements.namedItem("jobTitle") as HTMLInputElement | null)?.value.trim() || undefined,
          }),
        );
        if (manageFormEl) {
          showPostAction(root, manageFormEl, {
            title: result.emailChanged ? "Email address updated" : "Changes saved",
            message: result.emailChanged
              ? "We\u2019ve sent a confirmation email to your new address. Please click the link in that email to reactivate your registration."
              : "Your registration details have been updated. A confirmation email is on its way.",
          });
        }
      } catch (error) {
        handleSubmitError(error, form, statusEl);
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });
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
    if (noBtn) noBtn.disabled = true;

    await withLoadingButton(yesBtn, async () => {
      try {
        await patchJson<{ success: boolean }>(`${apiBase}/registrations/manage/${encodeURIComponent(token)}`, {
          action: "cancel",
        });
        cancelConfirmPanel?.classList.add("d-none");
        if (manageFormEl) {
          showPostAction(root, manageFormEl, {
            title: "Registration cancelled",
            message: "Your registration has been cancelled. You can re-register at any time if you change your mind.",
          });
        }
      } catch (error) {
        const normalized = normalizeValidation(error);
        cancelConfirmPanel?.classList.add("d-none");
        if (manageFormEl) manageFormEl.classList.remove("d-none");
        setStatus(statusEl, normalized.globalMessage, true);
        if (noBtn) noBtn.disabled = false;
      }
    });
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
    if (noBtn) noBtn.disabled = true;

    await withLoadingButton(yesBtn, async () => {
      try {
        await patchJson<{ success: boolean }>(`${apiBase}/registrations/manage/${encodeURIComponent(token)}`, {
          action: "report_unauthorized",
        });
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
        if (noBtn) noBtn.disabled = false;
      }
    });
  });
}

void main();
