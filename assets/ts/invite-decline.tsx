/**
 * Invite Decline Page
 *
 * Drives the Hugo-managed /invite/decline/ page.
 * Reads ?token= from the URL, fetches invite info, and handles the full
 * decline flow — including virtual-pivot, gap-analysis, NPS, forwarding, and
 * a "parting gift" success state.
 */

import { setButtonLoading, resetButton } from "./shared/form/button-loading";
import { inviteDeclineSchema } from "../shared/schemas/registration";
import { inviteDeclineInfoResponseSchema, inviteDeclineResponseSchema } from "../shared/schemas/invites";
import { getJson, postJson, ApiClientError } from "./shared/api-client";
import { showManageLinkRecoveryForm } from "./shared/widgets/link-recovery";
import { wireForwardList } from "./invite-decline-forward-list";
import type { z } from "zod";

type DeclineInfo = z.infer<typeof inviteDeclineInfoResponseSchema>;
type DeclineInfoValid = Extract<DeclineInfo, { status: "valid" }>;
type DeclinePayload = z.infer<typeof inviteDeclineSchema>;

// ── Reasons that trigger the virtual-pivot offer ──────────────────────────────
// schedule_conflict is intentionally excluded: a live remote stream has the same
// scheduling problem. We offer on-demand recordings instead (ON_DEMAND_REASONS).
const VIRTUAL_PIVOT_REASONS = new Set(["travel_not_possible"]);
const CONVINCE_BOSS_REASONS = new Set(["organization_policy"]);
const TOPIC_GAP_REASONS = new Set(["content_not_relevant"]);
const ON_DEMAND_REASONS = new Set(["schedule_conflict"]);

/**
 * The Alert modifier for each status the flow can land on. Full class names
 * per entry rather than a suffix interpolated into `pk-alert--${...}`, so
 * every design-system class this module writes is one a stylesheet defines.
 */
const STATUS_TONE_CLASS: Record<"warning" | "danger" | "info", string> = {
  warning: "pk-alert--warn",
  danger: "pk-alert--danger",
  info: "pk-alert--info",
};

// ── Copy variants (attendee vs speaker) ───────────────────────────────────────

type CopyVariants = Record<string, { attendee: string; speaker: string }>;

const COPY_TARGETS: CopyVariants = {
  heading: { attendee: "Not able to make it?", speaker: "Not able to submit a proposal?" },
  intro: {
    attendee:
      "Please let us know why. It helps us improve future events and make them more relevant to people like you.",
    speaker:
      "Please let us know why. It helps us improve future calls for proposals and make the event more relevant to speakers like you.",
  },
  "topic-label": {
    attendee: "What topic would make this event a must-attend for you?",
    speaker: "What theme, topic, or format would make this call for proposals compelling for you?",
  },
  "topic-help": {
    attendee: "helps us shape the agenda",
    speaker: "helps us shape the call for proposals and speaker experience",
  },
  "nps-question": {
    attendee: "On a scale of 1-10, how likely are you to attend our next PKI Consortium event?",
    speaker: "On a scale of 1-10, how likely are you to submit to a future PKI Consortium call for proposals?",
  },
  unsubscribe: {
    attendee: "Don't send me invitations to future events",
    speaker: "Don't send me proposal invitations to future events",
  },
  "forward-toggle": {
    attendee: "Know someone who should attend? Make sure they get an invitation",
    speaker: "Know someone who should submit a proposal? Make sure they get an invitation",
  },
  "forward-copy": {
    attendee: "They'll receive a personal invitation by email.",
    speaker: "They'll receive a personal proposal invitation by email.",
  },
  submit: { attendee: "Decline this invitation", speaker: "Decline this proposal invitation" },
  "success-title": { attendee: "Thank you for letting us know", speaker: "Thank you for letting us know" },
  "success-body": {
    attendee: "We hope to see you at a future event!",
    speaker: "We hope to hear from you in a future call for proposals!",
  },
};

const REASON_LABELS: CopyVariants = {
  schedule_conflict: {
    attendee: "Schedule conflict - I have another commitment",
    speaker: "I won't be able to prepare or submit in time",
  },
  travel_not_possible: {
    attendee: "Travel is not possible for me",
    speaker: "Travel to the event is not realistic for me as a speaker",
  },
  content_not_relevant: {
    attendee: "Content is not relevant to my role",
    speaker: "This call for proposals is not a fit for what I would present",
  },
  organization_policy: {
    attendee: "Organization policy prevents me from attending",
    speaker: "Organization policy prevents me from speaking or submitting",
  },
  not_interested: {
    attendee: "This event doesn't match my current focus",
    speaker: "Speaking at this event doesn't match my current focus",
  },
  already_registered: {
    attendee: "I'm already registered through another link",
    speaker: "I'm already involved in a proposal or already submitted",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function $(selector: string, root: Element | Document = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(selector);
}

/*
 * Visibility uses the `hidden` property rather than a utility class.
 *
 * The markup declares its initially-hidden regions with the `hidden`
 * attribute, so toggling a class would leave the attribute in place and the
 * element hidden forever. Using the property keeps one mechanism, and it is
 * the platform's own — it also removes this module's last dependency on
 * Bootstrap's display utilities.
 */
function show(el: HTMLElement | null): void {
  if (el) el.hidden = false;
}

function hide(el: HTMLElement | null): void {
  if (el) el.hidden = true;
}

// ── Initialize ────────────────────────────────────────────────────────────────

function boot(): void {
  const root = document.querySelector<HTMLElement>("[data-invite-decline]");
  if (!root) return;

  const apiBase = root.dataset.apiBase ?? "/api/v1";
  const query = new URLSearchParams(window.location.search);
  const token = query.get("token")?.trim();
  const inviteId = query.get("id")?.trim() || null;

  const loadingEl = $("[data-decline-loading]", root);
  const statusEl = $("[data-decline-status]", root);
  const formWrapEl = $("[data-decline-form]", root);
  const successEl = $("[data-decline-success]", root);

  if (!token) {
    showInviteRecovery("Invalid link", "This decline link is missing its token. Request a fresh invitation below.");
    return;
  }

  void run(token, apiBase, inviteId);

  // ── Status helper ───────────────────────────────────────────────────────────

  function showStatus(title: string, body: string, type: "warning" | "danger" | "info" = "warning"): void {
    hide(loadingEl);
    hide(formWrapEl);
    const alertEl = $("[data-status-alert]", root!);
    if (alertEl) {
      // The shortcode renders this banner as a design-system Alert, so the
      // script must repaint it in the same vocabulary. Assigning Bootstrap
      // here wiped `pk-alert` and left the banner unstyled.
      alertEl.className = `pk-alert ${STATUS_TONE_CLASS[type]}`;
    }
    const titleEl = $("[data-status-title]", root!);
    if (titleEl) titleEl.textContent = title;
    const bodyEl = $("[data-status-body]", root!);
    if (bodyEl) bodyEl.textContent = body;
    show(statusEl);
  }

  function showInviteRecovery(title: string, body: string): void {
    showStatus(title, body);
    showManageLinkRecoveryForm({
      root: root!,
      loadingSelector: "[data-decline-loading]",
      sectionSelector: "[data-resend-invite-section]",
      buttonSelector: "[data-resend-invite-btn]",
      statusSelector: "[data-resend-invite-status]",
      emailSelector: "[data-resend-invite-email]",
      endpoint: `${apiBase}/invites/resend-link`,
      successMessage:
        "If the email matches a pending invitation, a fresh link is on its way. Please check your inbox (and spam folder).",
    });
  }

  // ── Main flow ───────────────────────────────────────────────────────────────

  async function run(tok: string, base: string, id: string | null): Promise<void> {
    const inviteIdQuery = id ? `?id=${encodeURIComponent(id)}` : "";
    let info: DeclineInfo;
    try {
      info = await getJson(`${base}/invites/${tok}/decline-info${inviteIdQuery}`, inviteDeclineInfoResponseSchema);
    } catch {
      showStatus(
        "Something went wrong",
        "We could not load your invitation. Please check your connection and try again, or use the link from your original email.",
        "danger",
      );
      return;
    }

    hide(loadingEl);

    if (info.status === "already_processed") {
      showStatus(
        "Invitation already processed",
        "This invitation has already been accepted or declined. No further action is needed.",
        "info",
      );
      return;
    }

    if (info.status === "expired") {
      showInviteRecovery(
        "Invitation expired",
        "This invitation link is no longer valid. Request a fresh invitation below.",
      );
      return;
    }

    if (info.status === "invalid") {
      showInviteRecovery(
        "Invalid invitation link",
        "This link doesn\u2019t appear to be valid. Request a fresh invitation below.",
      );
      return;
    }
    if (info.status !== "valid") return;

    // Valid invite — personalise and show the form
    initForm(tok, base, info, inviteIdQuery);
  }

  // ── Form initialization ─────────────────────────────────────────────────────

  function initForm(tok: string, base: string, info: DeclineInfoValid, inviteIdQuery: string): void {
    // Personalise greeting
    const firstName = info.inviteeFirstName ?? "";
    root!.querySelectorAll<HTMLElement>("[data-placeholder='firstName']").forEach((el) => {
      el.textContent = firstName || "there";
    });

    applyInviteContextCopy(info);

    // Wire registration link for virtual pivot
    if (info.registrationUrl) {
      root!
        .querySelectorAll<HTMLAnchorElement>("[data-registration-link], [data-registration-link-boss]")
        .forEach((a) => {
          a.href = info.registrationUrl!;
        });
    }

    if (info.proposalUrl) {
      root!.querySelectorAll<HTMLAnchorElement>("[data-proposal-link]").forEach((a) => {
        a.href = info.proposalUrl!;
      });
    }

    buildNpsButtons();
    wireReasonRadios(info);
    wireForwardList(root!);
    wireSubmit(tok, base, info, inviteIdQuery);

    show(formWrapEl);
  }

  function applyInviteContextCopy(info: DeclineInfoValid): void {
    const role = info.inviteType === "speaker" ? "speaker" : "attendee";

    for (const [key, copy] of Object.entries(COPY_TARGETS)) {
      root!.querySelectorAll<HTMLElement>(`[data-copy-target='${key}']`).forEach((el) => {
        el.textContent = copy[role];
      });
    }

    for (const [key, copy] of Object.entries(REASON_LABELS)) {
      root!.querySelectorAll<HTMLElement>(`[data-reason-label='${key}']`).forEach((el) => {
        el.textContent = copy[role];
      });
    }

    if (role === "speaker") {
      root!.querySelectorAll<HTMLElement>("[data-attendee-only]").forEach((el) => hide(el));
    }
  }

  // ── NPS buttons ─────────────────────────────────────────────────────────────

  function buildNpsButtons(): void {
    const scores = root!.querySelectorAll<HTMLButtonElement>("[data-nps]");
    // The chosen score was signalled by fill alone, which says nothing to a
    // reader who cannot see it. `aria-pressed` states it, and the fill
    // follows from the design system's own primary/secondary variants.
    scores.forEach((button) => {
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        scores.forEach((other) => {
          other.classList.remove("pk-btn--primary");
          other.classList.add("pk-btn--secondary");
          other.setAttribute("aria-pressed", "false");
        });
        button.classList.remove("pk-btn--secondary");
        button.classList.add("pk-btn--primary");
        button.setAttribute("aria-pressed", "true");
        const hidden = $("[data-nps-value]", root!) as HTMLInputElement | null;
        if (hidden) hidden.value = button.dataset.nps ?? "";
      });
    });
  }

  // ── Reason radios — drive conditional panels ─────────────────────────────────

  function wireReasonRadios(info: DeclineInfoValid): void {
    const virtualPivot = $("[data-virtual-pivot]", root!);
    const convinceBoss = $("[data-convince-boss]", root!);
    const topicSuggestion = $("[data-topic-suggestion]", root!);
    const onDemandPivot = $("[data-on-demand-pivot]", root!);
    const noteOptional = $("[data-note-optional]", root!);
    const noteError = $("[data-note-error]", root!);

    root!.querySelectorAll<HTMLInputElement>("input[name='reasonCode']").forEach((radio) => {
      radio.addEventListener("change", () => {
        const val = radio.value;
        const isOther = val === "other";
        const isTopicGap = TOPIC_GAP_REASONS.has(val);
        const isVirtualPivot = VIRTUAL_PIVOT_REASONS.has(val) && !!info.registrationUrl;
        const isConvinceBoss = CONVINCE_BOSS_REASONS.has(val);
        const isOnDemand = ON_DEMAND_REASONS.has(val);

        // Virtual pivot offer
        if (isVirtualPivot) {
          show(virtualPivot);
        } else {
          hide(virtualPivot);
        }
        // On-demand recordings offer (schedule conflict)
        if (isOnDemand) {
          show(onDemandPivot);
        } else {
          hide(onDemandPivot);
        }
        // Convince-my-boss variant
        if (isConvinceBoss) {
          show(convinceBoss);
        } else {
          hide(convinceBoss);
        }
        // Topic gap analysis
        if (isTopicGap) {
          show(topicSuggestion);
        } else {
          hide(topicSuggestion);
        }

        // Note field: required for "other", optional otherwise
        if (noteOptional) {
          // The words carry it; the colour only agrees with them.
          noteOptional.textContent = isOther ? " (required)" : " (optional)";
          noteOptional.className = isOther ? "pk-required" : "pk-muted";
        }
        // And the control itself says so, rather than leaving the requirement
        // in a span the field is not described by.
        $("[data-reason-note]", root!)?.setAttribute("aria-required", isOther ? "true" : "false");
        hide(noteError);
        hide($("[data-reason-error]", root!));
      });
    });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function wireSubmit(tok: string, base: string, _info: DeclineInfoValid, inviteIdQuery: string): void {
    const formEl = $("[data-decline-form-el]", root!) as HTMLFormElement | null;
    if (!formEl) return;

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();

      const errorBanner = $("[data-error-banner]", root!);
      hide(errorBanner);

      // Validate reason
      const checkedReason = formEl.querySelector<HTMLInputElement>("input[name='reasonCode']:checked");
      const reasonError = $("[data-reason-error]", root!);
      if (!checkedReason) {
        show(reasonError);
        formEl.querySelector<HTMLElement>("input[name='reasonCode']")?.focus();
        return;
      }
      hide(reasonError);

      const reasonCode = checkedReason.value;

      // Merge topic suggestion into reasonNote if filled
      const topicInput = ($("[data-topic-input]", root!) as HTMLInputElement | null)?.value.trim() ?? "";
      let reasonNote = ($("[data-reason-note]", root!) as HTMLTextAreaElement | null)?.value.trim() ?? "";
      if (topicInput && !reasonNote) {
        reasonNote = `Topic suggestion: ${topicInput}`;
      } else if (topicInput && reasonNote) {
        reasonNote = `${reasonNote}\n\nTopic suggestion: ${topicInput}`;
      }

      // Validate "other" requires note
      const noteError = $("[data-note-error]", root!);
      if (reasonCode === "other" && !reasonNote) {
        show(noteError);
        ($("[data-reason-note]", root!) as HTMLElement | null)?.focus();
        return;
      }
      hide(noteError);

      // Collect forwards
      const forwardRows = root!.querySelectorAll<HTMLElement>("[data-forward-row]");
      const forwards: DeclinePayload["forwards"] = [];
      let forwardValid = true;
      forwardRows.forEach((row) => {
        const emailEl = row.querySelector<HTMLInputElement>("[data-fw='email']");
        const email = emailEl?.value.trim() ?? "";
        if (!email) {
          forwardValid = false;
          emailEl?.focus();
        } else {
          forwards.push({
            email,
            firstName: row.querySelector<HTMLInputElement>("[data-fw='firstName']")?.value.trim() || undefined,
            lastName: row.querySelector<HTMLInputElement>("[data-fw='lastName']")?.value.trim() || undefined,
          });
        }
      });

      if (!forwardValid) {
        if (errorBanner) {
          errorBanner.textContent = "Please fill in the email address for each contact, or remove incomplete rows.";
          show(errorBanner);
        }
        return;
      }

      // NPS score
      const npsRaw = ($("[data-nps-value]", root!) as HTMLInputElement | null)?.value;
      const npsScore = npsRaw ? parseInt(npsRaw, 10) : undefined;

      const payload = inviteDeclineSchema.parse({
        reasonCode,
        reasonNote: reasonNote || undefined,
        unsubscribeFuture: ($("[data-unsubscribe-future]", root!) as HTMLInputElement | null)?.checked || undefined,
        npsScore: npsScore && npsScore >= 1 && npsScore <= 10 ? npsScore : undefined,
        forwards: forwards.length > 0 ? forwards : undefined,
      });

      const submitBtn = $("[data-submit-btn]", root!) as HTMLButtonElement | null;
      if (submitBtn) setButtonLoading(submitBtn);

      try {
        const result = await postJson(
          `${base}/invites/${tok}/decline${inviteIdQuery}`,
          payload,
          inviteDeclineResponseSchema,
        );

        if (result.success) {
          const forwardedMsg = $("[data-success-forwarded]", root!);
          if (forwardedMsg && result.forwarded?.length) {
            forwardedMsg.textContent = `We\u2019ve sent an invitation to ${result.forwarded.join(", ")}. We hope to see them there!`;
          }
          hide(formWrapEl);
          show(successEl);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          throw new Error("Submission was not successful");
        }
      } catch (err: unknown) {
        let msg = "Something went wrong. Please try again.";
        if (err instanceof ApiClientError && err.code === "INVITE_NOT_ACTIVE") {
          msg = "This invitation has already been accepted or declined.";
        } else if (err instanceof Error) {
          msg = err.message;
        }
        if (errorBanner) {
          errorBanner.textContent = msg;
          show(errorBanner);
        }
        if (submitBtn) resetButton(submitBtn);
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
