import { Fragment, render } from "preact";
import { getJson, patchJson } from "../shared/api-client";
import { formatDateTime } from "../shared/ui";
import type { EventFormsResponse, RegistrationManageResponse } from "../shared/types";
import { eventFormsResponseSchema } from "../../shared/schemas/forms";
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
import {
  registrationManageReadResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  type AttendanceType,
} from "../../shared/schemas/registration";
import { buildManageLinkRecoveryMessage, showPostAction, showResendManageLinkForm } from "./registration-manage-panels";
import { setField, deriveEventAttendanceType, findSubmitButton } from "../shared/form/helpers";
import {
  hasPendingRegistrationDayWaitlist,
  isPendingRegistrationDayWaitlistStatus,
} from "../components/RegistrationDayStatusSummary";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Kicker } from "../ui/Kicker";
// `pk-datalist` is defined in Content.css, which ships in a lazy chunk rather
// than the entry stylesheet. `pk-btn` and `pk-badge` are written by the two
// imperative branches below and ship with the entry, because the public
// shortcodes this page renders into write them too.
import "../ui/Content.css";

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

/** The tone of a day-waitlist entry. The words beside it carry the meaning. */
function waitlistTone(status: string): BadgeTone {
  if (status === "offered") return "info";
  if (status === "accepted") return "ok";
  return "neutral";
}

/** What one day's waitlist state says, and the tone that agrees with it. */
function dayConfirmation(waitlistStatus: string | undefined): { label: string; tone: BadgeTone } {
  if (waitlistStatus === "offered") return { label: "Spot available", tone: "info" };
  if (waitlistStatus === "waiting") return { label: "Waitlisted", tone: "warn" };
  return { label: "Confirmed", tone: "ok" };
}

function RegistrationStatusBanner({
  dayAttendance,
  dayWaitlist,
}: {
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist: Array<{ dayDate: string; status: string }>;
}) {
  const activeDayWaitlist = dayWaitlist.filter((entry) => isPendingRegistrationDayWaitlistStatus(entry.status));
  const offeredDayWaitlist = activeDayWaitlist.filter((entry) => entry.status === "offered");
  const waitlistByDay = new Map(activeDayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));

  return (
    <div class="pk pk-stack pk-stack--snug">
      <p>
        <strong>Registration status:</strong>{" "}
        {offeredDayWaitlist.length > 0 ? (
          <>
            <Badge tone="info">Spot available</Badge> An in-person spot is available for one or more waitlisted days.
            Use the claim button below while the offer is active.
          </>
        ) : (
          <>
            <Badge tone="ok">Confirmed</Badge> Your registration is active and confirmed.
          </>
        )}
      </p>
      {dayAttendance.length > 0 && (
        <div class="pk-stack pk-stack--tight">
          <Kicker as="p">How you are attending each day</Kicker>
          {/* A day and what is confirmed for it are a term and its value, so
              they are a description list rather than a stripped `ul` whose
              every row re-derives the same flex declarations. */}
          <dl class="pk-datalist">
            {dayAttendance.map((day) => {
              const dayLabel = day.label ?? day.dayDate;
              const attLabel = attendanceTypeLabel(day.attendanceType);
              const waitlistStatus = waitlistByDay.get(day.dayDate);
              const confirmation = dayConfirmation(waitlistStatus);
              return (
                <Fragment key={day.dayDate}>
                  <dt>{dayLabel}</dt>
                  <dd class="pk-cluster">
                    <span>{attLabel}</span>
                    <Badge tone={confirmation.tone}>{confirmation.label}</Badge>
                  </dd>
                </Fragment>
              );
            })}
          </dl>
        </div>
      )}
      {activeDayWaitlist.length > 0 && (
        <p class="pk-small">
          Some day-specific entries still need attention. If that no longer works for you, update the selections below
          or cancel the registration.
        </p>
      )}
    </div>
  );
}

function statusLabel(status: string, cancellationReasonCode: string | null): { label: string; cssClass: string } {
  switch (status) {
    case "registered":
      return { label: "Confirmed", cssClass: "pk-badge--ok" };
    case "pending_email_confirmation":
      return { label: "Pending confirmation", cssClass: "pk-badge--neutral" };
    case "cancelled":
      return {
        label: cancellationReasonCode === "unauthorized_registration" ? "Cancelled (unauthorized)" : "Cancelled",
        cssClass: "pk-badge--danger",
      };
    default:
      return { label: status, cssClass: "pk-badge--neutral" };
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
      getJson(`${apiBase}/registrations/access/${encodeURIComponent(token)}`, registrationManageReadResponseSchema),
      getJson(`${apiBase}/events/${eventSlug}/forms/placements/event_registration`, eventFormsResponseSchema).catch(
        () => null,
      ),
    ]);
  } catch (error) {
    const normalized = normalizeValidation(error);
    showResendManageLinkForm(root, apiBase, eventSlug, buildManageLinkRecoveryMessage(normalized.globalMessage));
    return;
  }

  const { registration, event, user, eventDays, dayAttendance, dayWaitlist } = manageData;
  const isCancelled = registration.status === "cancelled";
  const eventName = event?.name ?? eventSlug;
  const firstName = user?.first_name ?? "";

  if (statusBanner) {
    if (hasPendingRegistrationDayWaitlist(dayWaitlist ?? [])) {
      render(<RegistrationStatusBanner dayAttendance={dayAttendance} dayWaitlist={dayWaitlist ?? []} />, statusBanner);
      statusBanner.hidden = false;
    }
  }

  // ── Greeting ──────────────────────────────────────────────────────────────
  if (greetingEl && greetingText && statusBadge) {
    greetingText.textContent = firstName
      ? `Hi ${firstName}, we're looking forward to seeing you at ${eventName}!`
      : `Your registration for ${eventName}`;
    const { label, cssClass } = statusLabel(registration.status, registration.cancellation_reason_code);
    statusBadge.textContent = label;
    statusBadge.className = `pk-badge ${cssClass}`;
    greetingEl.hidden = false;
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
      emailChangeNotice.hidden = !changed;
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
    customFieldsSection.hidden = true;
  }

  // ── Day attendance ────────────────────────────────────────────────────────
  if (dayAttendanceContainer) {
    renderDayAttendance(dayAttendanceContainer, eventDays);
    writeDayAttendance(form, dayAttendance);
  }

  // ── Day waitlist (only shown when there are active entries) ──────────────
  if (dayWaitlistContainer && dayWaitlistSection) {
    const activeDayWaitlist = (dayWaitlist ?? []).filter((entry) =>
      isPendingRegistrationDayWaitlistStatus(entry.status),
    );
    const labelByDayDate = new Map(eventDays.map((day) => [day.dayDate, day.label ?? day.dayDate] as const));
    if (activeDayWaitlist.length > 0) {
      const offeredDayDates = activeDayWaitlist
        .filter((entry) => entry.status === "offered")
        .map((entry) => entry.dayDate);
      render(
        <>
          {offeredDayDates.length > 0 && (
            <div class="event-flow-day-waitlist-offer pk-stack pk-stack--snug">
              <p>An in-person spot is available. Claim it before the offer expires.</p>
              {/* Class names rather than the `Button` component, because
                  `withLoadingButton` drives this control imperatively. */}
              <button
                type="button"
                class="pk-btn pk-btn--sm pk-btn--primary"
                onClick={(event) => {
                  const button = event.currentTarget as HTMLButtonElement;
                  void withLoadingButton(button, async () => {
                    try {
                      const selections = readDayAttendance(form);
                      await patchJson(
                        `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
                        { action: "update", dayAttendance: selections, claimDayWaitlistOffers: offeredDayDates },
                        registrationManageUpdateResponseSchema,
                      );
                      if (manageFormEl) {
                        showPostAction(root, manageFormEl, {
                          title: "In-person spot claimed",
                          message: "Your day attendance has been confirmed. A confirmation email is on its way.",
                        });
                      }
                    } catch (error) {
                      handleSubmitError(error, form, statusEl);
                    }
                  });
                }}
              >
                Claim offered {offeredDayDates.length === 1 ? "spot" : "spots"}
              </button>
            </div>
          )}
          <div class="event-flow-day-waitlist pk-cluster">
            {activeDayWaitlist.map((entry) => {
              const expiry = entry.offerExpiresAt ? `, offer expires ${formatDateTime(entry.offerExpiresAt)}` : "";
              const dayLabel = labelByDayDate.get(entry.dayDate) ?? entry.dayDate;
              const statusText = entry.status === "offered" ? "In-person spot available" : "Waiting for in-person seat";
              return (
                // The state is spelled out inside the badge, so the tone only
                // agrees with the words rather than carrying them.
                <Badge key={entry.dayDate} tone={waitlistTone(entry.status)}>
                  {dayLabel}: {statusText} ({entry.priorityLane}
                  {expiry})
                </Badge>
              );
            })}
          </div>
        </>,
        dayWaitlistContainer,
      );
      dayWaitlistSection.hidden = false;
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
    if (registration.cancellation_reason_code === "unauthorized_registration") {
      setStatus(
        statusEl,
        "This registration was reported as unauthorized and cannot be restored through self-service. Please contact the organizer if it should be reviewed.",
        true,
      );
    } else if (isEmailVerified) {
      // Email verified but registration cancelled for other reason → offer simple restore
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "pk-btn pk-btn--primary";
      restoreBtn.textContent = "Restore Registration";
      let restoring = false;
      restoreBtn.onclick = async (e) => {
        e.preventDefault();
        if (restoring) return;
        restoring = true;
        restoreBtn.disabled = true;
        try {
          await patchJson(
            `/api/v1/registrations/access/${encodeURIComponent(token)}`,
            { action: "update" },
            registrationManageUpdateResponseSchema,
          );
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
      // The gap between the banner and the button is the parent's, replacing
      // the `mt-2` the button used to carry: one decision instead of two.
      statusEl?.parentElement?.classList.add("pk-stack", "pk-stack--snug");
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
  if (loadingEl) loadingEl.hidden = true;
  if (manageFormEl) manageFormEl.hidden = false;

  // ── Share panel ───────────────────────────────────────────────────────────
  const sharePanelEl = root.querySelector<HTMLElement>("[data-manage-share]");
  if (sharePanelEl && manageData.shareUrl) {
    renderSharePanel(sharePanelEl, {
      shareUrl: manageData.shareUrl,
      eventName,
      firstName,
      lastName: user?.last_name ?? undefined,
      manageToken: token,
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
    if (headshotSection) headshotSection.hidden = true;
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
    // `was-validated` is not set here any more: `validateBeforeSubmit` adds it
    // in the one case it means anything — a submission that failed — and
    // setting it up front marked a form the reader had not got wrong yet.
    if (!validateBeforeSubmit(form, statusEl)) return;

    const submitBtn = findSubmitButton(form);
    const cancelBtn = form.querySelector<HTMLButtonElement>("[data-action='cancel']");
    if (cancelBtn) cancelBtn.disabled = true;

    await withLoadingButton(submitBtn, async () => {
      try {
        const dayAttendancePayload = readDayAttendance(form);
        const emailValue = (form.elements.namedItem("email") as HTMLInputElement | null)?.value.trim() || undefined;
        const emailIsChanged = emailValue && emailValue.toLowerCase() !== originalEmail;
        const result = await patchJson(
          `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
          registrationManageSchema.parse({
            action: "update",
            attendanceType:
              dayAttendancePayload.length === 0 ? (registration.attendance_type as AttendanceType) : undefined,
            dayAttendance: dayAttendancePayload,
            customAnswers: customFieldsRendered ? readCustomFieldValues(form) : undefined,
            email: emailIsChanged ? emailValue : undefined,
            firstName: (form.elements.namedItem("firstName") as HTMLInputElement | null)?.value.trim() || undefined,
            lastName: (form.elements.namedItem("lastName") as HTMLInputElement | null)?.value.trim() || undefined,
            organizationName:
              (form.elements.namedItem("organizationName") as HTMLInputElement | null)?.value.trim() || undefined,
            jobTitle: (form.elements.namedItem("jobTitle") as HTMLInputElement | null)?.value.trim() || undefined,
          }),
          registrationManageUpdateResponseSchema,
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
    if (manageFormEl) manageFormEl.hidden = true;
    if (cancelConfirmPanel) cancelConfirmPanel.hidden = false;
  });

  root.querySelector<HTMLButtonElement>("[data-confirm-cancel-no]")?.addEventListener("click", () => {
    if (cancelConfirmPanel) cancelConfirmPanel.hidden = true;
    if (manageFormEl) manageFormEl.hidden = false;
  });

  root.querySelector<HTMLButtonElement>("[data-confirm-cancel-yes]")?.addEventListener("click", async () => {
    const yesBtn = root.querySelector<HTMLButtonElement>("[data-confirm-cancel-yes]");
    const noBtn = root.querySelector<HTMLButtonElement>("[data-confirm-cancel-no]");
    if (noBtn) noBtn.disabled = true;

    await withLoadingButton(yesBtn, async () => {
      try {
        await patchJson(
          `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
          { action: "cancel" },
          registrationManageUpdateResponseSchema,
        );
        if (cancelConfirmPanel) cancelConfirmPanel.hidden = true;
        if (manageFormEl) {
          showPostAction(root, manageFormEl, {
            title: "Registration cancelled",
            message: "Your registration has been cancelled. You can re-register at any time if you change your mind.",
          });
        }
      } catch (error) {
        const normalized = normalizeValidation(error);
        if (cancelConfirmPanel) cancelConfirmPanel.hidden = true;
        if (manageFormEl) manageFormEl.hidden = false;
        setStatus(statusEl, normalized.globalMessage, true);
        if (noBtn) noBtn.disabled = false;
      }
    });
  });

  // ── Report unauthorized flow ──────────────────────────────────────────────
  root.querySelector<HTMLButtonElement>("[data-action='report-unauthorized']")?.addEventListener("click", () => {
    if (isCancelled) return;
    if (manageFormEl) manageFormEl.hidden = true;
    if (unauthorizedPanel) unauthorizedPanel.hidden = false;
  });

  root.querySelector<HTMLButtonElement>("[data-unauthorized-no]")?.addEventListener("click", () => {
    if (unauthorizedPanel) unauthorizedPanel.hidden = true;
    if (manageFormEl) manageFormEl.hidden = false;
  });

  root.querySelector<HTMLButtonElement>("[data-unauthorized-yes]")?.addEventListener("click", async () => {
    const yesBtn = root.querySelector<HTMLButtonElement>("[data-unauthorized-yes]");
    const noBtn = root.querySelector<HTMLButtonElement>("[data-unauthorized-no]");
    if (noBtn) noBtn.disabled = true;

    await withLoadingButton(yesBtn, async () => {
      try {
        await patchJson(
          `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
          { action: "report_unauthorized" },
          registrationManageUpdateResponseSchema,
        );
        if (unauthorizedPanel) unauthorizedPanel.hidden = true;
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
        if (unauthorizedPanel) unauthorizedPanel.hidden = true;
        if (manageFormEl) manageFormEl.hidden = false;
        setStatus(statusEl, normalized.globalMessage, true);
        if (noBtn) noBtn.disabled = false;
      }
    });
  });
}

void main();
