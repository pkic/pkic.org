import { RegistrationFlow } from "../components/events/RegistrationFlow";
import { mountSponsorContactSharing } from "../components/SponsorContactSharing";
import { Fragment, render } from "preact";
import { getJson, patchJson } from "../shared/api-client";
import { formatDateTime } from "../shared/ui";
import type { EventFormsResponse, RegistrationManageResponse } from "../shared/types";
import { eventFormsResponseSchema } from "../../shared/schemas/forms";
import { normalizeValidation } from "../shared/form/validation-map";
import { clearStatus } from "../shared/form/validation";
import { renderSharePanel, refreshSharePanelBadge } from "../shared/widgets/share-panel";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { eventFlowContext, setStatus } from "./boot";
import { mountTokenHeadshot } from "./token-headshot";
import { createUrlDialogState, subscribeUrlQuery } from "../ui/url-query";
import {
  registrationManageReadResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../../shared/schemas/registration";
import { buildManageLinkRecoveryMessage, showPostAction, showResendManageLinkForm } from "./registration-manage-panels";
import {
  hasPendingRegistrationDayWaitlist,
  isPendingRegistrationDayWaitlistStatus,
} from "../components/RegistrationDayStatusSummary";
import { Badge } from "../ui/Badge";
import { attendanceTypeLabel, dayConfirmation, statusLabel, waitlistTone } from "./registration-manage-status";
import { eventMyAgendaPath } from "../../shared/event-participation-link";
import { Kicker } from "../ui/Kicker";
import { confirmAction } from "../components/ConfirmDialog";
import { RegistrationManageSummary } from "./registration-manage-summary";
import { CancelledRegistrationNotice } from "./registration-cancelled-notice";
// `pk-datalist` is defined in Content.css, which ships in a lazy chunk rather
// than the entry stylesheet. `pk-btn` and `pk-badge` are written by the two
// imperative branches below and ship with the entry, because the public
// shortcodes this page renders into write them too.
import "../ui/Content.css";

function RegistrationStatusBanner({
  dayAttendance,
  dayWaitlist,
}: {
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null; optionLabel?: string | null }>;
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
            <Badge tone="info">Place available</Badge> A place is available for one or more waitlisted days. Use the
            claim button below while the offer is active.
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
              const attLabel = day.optionLabel ?? attendanceTypeLabel(day.attendanceType);
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const boot = eventFlowContext(document.querySelector<HTMLElement>("[data-event-registration-manage]"));
  if (!boot) return;

  const { eventSlug, apiBase, query, root } = boot;
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]")!;
  const editorEl = root.querySelector<HTMLElement>("[data-registration-editor]")!;
  // The update contract decides what is valid, and the server's refusal names
  // any custom answer it rejects; the browser's own bubbles never speak first.

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
  const dayWaitlistContainer = root.querySelector<HTMLElement>("[data-day-waitlist]");
  const dayWaitlistSection = root.querySelector<HTMLElement>("[data-day-waitlist-section]");
  const summaryEl = root.querySelector<HTMLElement>("[data-manage-summary]");

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

  mountSponsorContactSharing(
    root,
    `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
    manageData.sponsorSharing,
  );
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
    greetingText.textContent = isCancelled
      ? `Your registration for ${eventName} is cancelled.`
      : firstName
        ? `Hi ${firstName}, we're looking forward to seeing you at ${eventName}!`
        : `Your registration for ${eventName}`;
    const { label, cssClass } = statusLabel(registration.status, registration.cancellation_reason_code);
    statusBadge.textContent = label;
    statusBadge.className = `pk-badge ${cssClass}`;
    // The attendee's own agenda lives in the portal; a cancelled
    // registration has no sessions to plan.
    if (!isCancelled && !greetingEl.querySelector("[data-manage-agenda-link]")) {
      const agendaLink = document.createElement("a");
      agendaLink.href = eventMyAgendaPath(event?.slug ?? eventSlug);
      agendaLink.textContent = "My agenda";
      agendaLink.dataset.manageAgendaLink = "";
      greetingEl.append(agendaLink);
    }
    greetingEl.hidden = false;
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
              <p>A spot is available. Claim it before the offer expires.</p>
              {/* Class names rather than the `Button` component, because
                  `withLoadingButton` drives this control imperatively. */}
              <button
                type="button"
                class="pk-btn pk-btn--primary"
                onClick={(event) => {
                  const button = event.currentTarget as HTMLButtonElement;
                  void withLoadingButton(button, async () => {
                    try {
                      const selections = dayAttendance.map(({ dayDate, attendanceType }) => ({
                        dayDate,
                        attendanceType,
                      }));
                      await patchJson(
                        `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
                        { action: "update", dayAttendance: selections, claimDayWaitlistOffers: offeredDayDates },
                        registrationManageUpdateResponseSchema,
                      );
                      if (manageFormEl) {
                        showPostAction(root, manageFormEl, {
                          title: "Spot claimed",
                          message: "Your day attendance has been confirmed. A confirmation email is on its way.",
                        });
                      }
                    } catch (error) {
                      handleSubmitError(error, null, statusEl);
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
              const statusText = entry.status === "offered" ? "Spot available" : "On the waitlist";
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

  // ── A cancelled registration leads with that, says why, and offers restore when it can be ──
  if (isCancelled && statusBanner) {
    const restore = async () => {
      try {
        await patchJson(
          `/api/v1/registrations/access/${encodeURIComponent(token)}`,
          { action: "update" },
          registrationManageUpdateResponseSchema,
        );
        // The cancellation notice and greeting no longer hold once the registration is restored.
        for (const element of [greetingEl, statusBanner]) if (element) element.hidden = true;
        if (manageFormEl) {
          showPostAction(root, manageFormEl, {
            title: "Registration restored",
            message: "Your registration has been restored. This page reloads in a moment.",
          });
        }
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        if (manageFormEl) {
          showPostAction(root, manageFormEl, {
            title: "Restore failed",
            message: (error as Error).message,
            isError: true,
          });
        }
        throw error;
      }
    };
    render(
      <CancelledRegistrationNotice
        reason={
          registration.cancellation_reason_code === "unauthorized_registration"
            ? "unauthorized"
            : manageData.registration.isEmailVerified
              ? "restorable"
              : "unverified"
        }
        onRestore={restore}
      />,
      statusBanner,
    );
    statusBanner.hidden = false;
  }

  // ── Show the registration, read-only until the attendee asks to edit ──────
  if (loadingEl) loadingEl.hidden = true;
  if (manageFormEl) manageFormEl.hidden = false;
  editorEl.hidden = true;

  // ── Share panel ───────────────────────────────────────────────────────────
  const sharePanelEl = root.querySelector<HTMLElement>("[data-manage-share]");
  // A cancelled registration has no badge to print and no seat to invite colleagues alongside.
  if (sharePanelEl && manageData.shareUrl && !isCancelled) {
    renderSharePanel(sharePanelEl, {
      shareUrl: manageData.shareUrl,
      badgeVersion: manageData.badgeVersion,
      eventName,
      firstName,
      lastName: user?.last_name ?? undefined,
      manageToken: token,
      eventSlug,
      invitation: { status: registration.status, startsAt: event.startsAt },
      waitlisted: hasPendingRegistrationDayWaitlist(dayWaitlist ?? []),
    });
  }

  // ── Headshot section ──────────────────────────────────────────────────────
  const headshotSection = root.querySelector<HTMLElement>("[data-headshot-section]");
  if (!isCancelled) {
    mountTokenHeadshot({
      section: headshotSection,
      name: [firstName, user?.last_name].filter(Boolean).join(" ") || (user?.email ?? "You"),
      initialUrl: manageData.headshotUrl,
      url: `${apiBase}/registrations/access/${encodeURIComponent(token)}/headshot`,
      successNote: "Your social badge has been updated.",
      onChanged: () => {
        if (sharePanelEl) refreshSharePanelBadge(sharePanelEl);
      },
    });
  } else if (headshotSection) {
    headshotSection.hidden = true;
  }

  // ── Read view, and the edit command that swaps it for the form ────────────
  const editorNavigation = createUrlDialogState("editRegistration", "search", location.pathname);
  let editorMounted = false;
  const showEditor = (editing: boolean) => {
    if (editing && isCancelled) {
      void editorNavigation.close(editorNavigation.marker());
      return;
    }
    if (summaryEl) summaryEl.hidden = editing;
    editorEl.hidden = !editing;
    if (!editing) {
      return;
    }
    if (!formsData) {
      setStatus(statusEl, "Could not load registration form details. Reload this page to try again.", true);
      void editorNavigation.close(editorNavigation.marker());
      return;
    }
    if (editorMounted) return;
    editorMounted = true;
    const marker = editorNavigation.marker();
    render(
      <RegistrationFlow
        mode="update"
        data={manageData}
        forms={formsData}
        onProfileUpdated={async () => {
          try {
            manageData = await getJson(
              `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
              registrationManageReadResponseSchema,
            );
            renderSummary();
            if (sharePanelEl) refreshSharePanelBadge(sharePanelEl);
            clearStatus(statusEl);
          } catch (error) {
            setStatus(
              statusEl,
              "Your representation was saved, but the registration could not be refreshed. Reload this page to try again.",
              true,
            );
            throw error;
          }
        }}
        onDiscard={() => {
          render(null, editorEl);
          editorMounted = false;
          void editorNavigation.close(marker);
        }}
        save={async (change) => {
          await patchJson(
            `${apiBase}/registrations/access/${encodeURIComponent(token)}`,
            change,
            registrationManageUpdateResponseSchema,
          );
          await editorNavigation.close(marker);
          if (manageFormEl)
            showPostAction(root, manageFormEl, {
              title: "Changes saved",
              message: "Your registration details have been updated. A confirmation email is on its way.",
            });
        }}
      />,
      editorEl,
    );
  };
  const stopEditorNavigation = subscribeUrlQuery(() => {
    if (!root.isConnected) {
      stopEditorNavigation();
      return;
    }
    showEditor(Boolean(editorNavigation.marker()));
  });
  showEditor(Boolean(editorNavigation.marker()));
  renderSummary();
  function renderSummary() {
    if (summaryEl) {
      render(
        <RegistrationManageSummary
          data={manageData}
          form={formsData?.form ?? null}
          editable={!isCancelled}
          // The photo tile mounts the page's confirmation host when it is shown;
          // a page without it still needs one for the commands below.
          dialogHost={isCancelled || !headshotSection?.querySelector("[data-headshot-tile]")}
          onEdit={() => {
            clearStatus(statusEl);
            editorNavigation.show();
          }}
          onCancel={() => void cancelRegistration()}
          onReport={() => void reportUnauthorized()}
        />,
        summaryEl,
      );
    }
  }

  // ── Whole-record commands, each confirmed in the shared dialog ────────────
  const accessUrl = `${apiBase}/registrations/access/${encodeURIComponent(token)}`;
  async function sendRecordCommand(
    action: "cancel" | "report_unauthorized",
    outcome: { title: string; message: string },
  ): Promise<void> {
    try {
      await patchJson(accessUrl, registrationManageSchema.parse({ action }), registrationManageUpdateResponseSchema);
      // The welcome, the status pill and the badge and invitation panel belonged to the active registration.
      for (const element of [greetingEl, sharePanelEl, statusBanner]) if (element) element.hidden = true;
      if (manageFormEl) showPostAction(root, manageFormEl, outcome);
    } catch (error) {
      setStatus(statusEl, normalizeValidation(error).globalMessage, true);
    }
  }

  async function cancelRegistration(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Cancel your registration?",
      body:
        `Your place at ${eventName} is released for someone else. You can register again later while ` +
        "registration is open, but a released place or waitlist position is not held for you.",
      confirmLabel: "Cancel registration",
      cancelLabel: "Keep registration",
    });
    if (!confirmed) return;
    await sendRecordCommand("cancel", {
      title: "Registration cancelled",
      message: "Your registration has been cancelled. You can re-register at any time if you change your mind.",
    });
  }

  async function reportUnauthorized(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Report an unauthorized registration?",
      body:
        "You are reporting that you did not request this registration. Your account and email address are not " +
        "deleted; only this registration record is anonymized.",
      consequences: [
        "Cancel and flag this registration as unauthorized",
        "Remove the personal data stored with this registration",
        "Notify the event organizer, who may investigate potential misuse",
      ],
      confirmLabel: "Report unauthorized registration",
      cancelLabel: "Keep registration",
    });
    if (!confirmed) return;
    await sendRecordCommand("report_unauthorized", {
      title: "Report received",
      message:
        "Your registration has been cancelled and your event-specific data removed. " +
        "The organizer has been notified and will review for potential misuse.",
    });
  }
}

void main();
