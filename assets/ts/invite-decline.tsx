/**
 * Invite Decline Page
 *
 * Drives the Hugo-managed /invite/decline/ page.
 * Reads ?token= from the URL, fetches invite info, and handles the full
 * decline flow — including virtual-pivot, gap-analysis, NPS, forwarding, and
 * a "parting gift" success state.
 */

import { render } from "preact";
import { setButtonLoading, resetButton } from "./shared/form/button-loading";
import { inviteDeclineSchema } from "../shared/schemas/api";
import { getJson, postJson, ApiClientError } from "./shared/api-client";
import { parseContactText } from "./shared/invite-parser";
import type { ParsedContact } from "./shared/invite-parser";

interface DeclineInfoValid {
  status: "valid";
  eventName: string | null;
  inviteeFirstName: string | null;
  inviteType: "attendee" | "speaker";
  registrationUrl: string | null;
  proposalUrl: string | null;
}

interface DeclineInfoOther {
  status: "already_processed" | "expired" | "invalid";
}

type DeclineInfo = DeclineInfoValid | DeclineInfoOther;

interface DeclinePayload {
  reasonCode: string;
  reasonNote?: string;
  unsubscribeFuture?: boolean;
  npsScore?: number;
  forwards?: { email: string; firstName?: string; lastName?: string }[];
}

// ── Reasons that trigger the virtual-pivot offer ──────────────────────────────
// schedule_conflict is intentionally excluded: a live remote stream has the same
// scheduling problem. We offer on-demand recordings instead (ON_DEMAND_REASONS).
const VIRTUAL_PIVOT_REASONS = new Set(["travel_not_possible"]);
const CONVINCE_BOSS_REASONS = new Set(["organization_policy"]);
const TOPIC_GAP_REASONS = new Set(["content_not_relevant"]);
const ON_DEMAND_REASONS = new Set(["schedule_conflict"]);

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
    attendee: "Organisation policy prevents me from attending",
    speaker: "Organisation policy prevents me from speaking or submitting",
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

function show(el: HTMLElement | null): void {
  el?.classList.remove("d-none");
}

function hide(el: HTMLElement | null): void {
  el?.classList.add("d-none");
}

// ── Initialise ────────────────────────────────────────────────────────────────

function boot(): void {
  const root = document.querySelector<HTMLElement>("[data-invite-decline]");
  if (!root) return;

  const apiBase = root.dataset.apiBase ?? "/api/v1";
  const token = new URLSearchParams(window.location.search).get("token")?.trim();

  const loadingEl = $("[data-decline-loading]", root);
  const statusEl = $("[data-decline-status]", root);
  const formWrapEl = $("[data-decline-form]", root);
  const successEl = $("[data-decline-success]", root);

  if (!token) {
    showStatus("Invalid link", "This decline link is missing its token. Please use the link from your email.");
    return;
  }

  void run(token, apiBase);

  // ── Status helper ───────────────────────────────────────────────────────────

  function showStatus(title: string, body: string, type: "warning" | "danger" | "info" = "warning"): void {
    hide(loadingEl);
    hide(formWrapEl);
    const alertEl = $("[data-status-alert]", root!);
    if (alertEl) {
      alertEl.className = `alert alert-${type}`;
    }
    const titleEl = $("[data-status-title]", root!);
    if (titleEl) titleEl.textContent = title;
    const bodyEl = $("[data-status-body]", root!);
    if (bodyEl) bodyEl.textContent = body;
    show(statusEl);
  }

  // ── Main flow ───────────────────────────────────────────────────────────────

  async function run(tok: string, base: string): Promise<void> {
    let info: DeclineInfo;
    try {
      info = await getJson<DeclineInfo>(`${base}/invites/${tok}/decline-info`);
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
      showStatus(
        "Invitation expired",
        "This invitation link is no longer valid. Please contact us if you need a new one.",
      );
      return;
    }

    if (info.status === "invalid") {
      showStatus(
        "Invalid invitation link",
        "This link doesn\u2019t appear to be valid. Please use the link from your original email.",
      );
      return;
    }

    // Valid invite — personalise and show the form
    initForm(tok, base, info as DeclineInfoValid);
  }

  // ── Form initialisation ─────────────────────────────────────────────────────

  function initForm(tok: string, base: string, info: DeclineInfoValid): void {
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
    wireForwardToggle();
    wireSubmit(tok, base, info);

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
    root!.querySelectorAll<HTMLButtonElement>("[data-nps]").forEach((btn) => {
      btn.addEventListener("click", () => {
        root!.querySelectorAll("[data-nps]").forEach((b) => b.classList.remove("btn-primary", "active"));
        root!.querySelectorAll("[data-nps]").forEach((b) => b.classList.add("btn-outline-secondary"));
        btn.classList.remove("btn-outline-secondary");
        btn.classList.add("btn-primary", "active");
        const hidden = $("[data-nps-value]", root!) as HTMLInputElement | null;
        if (hidden) hidden.value = btn.dataset.nps ?? "";
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
          noteOptional.textContent = isOther ? " (required)" : " (optional)";
          noteOptional.className = isOther ? "fw-normal text-danger" : "text-muted fw-normal";
        }
        noteError?.classList.add("d-none");
        $("[data-reason-error]", root!)?.classList.add("d-none");
      });
    });
  }

  // ── Forward section ─────────────────────────────────────────────────────────

  /** Maximum number of forward contacts. Read from data-forward-max; defaults to 10. */
  const MAX_FORWARDS = parseInt(root.dataset.forwardMax ?? "", 10) || 10;
  let forwardCount = 0;

  function wireForwardToggle(): void {
    const toggleBtn = $("[data-forward-toggle]", root!);
    const forwardEntries = $("[data-forward-entries]", root!);
    const arrowEl = $("[data-forward-arrow]", root!);

    toggleBtn?.addEventListener("click", () => {
      const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", String(!expanded));
      if (arrowEl) arrowEl.textContent = !expanded ? "▼" : "▶";
      if (!expanded) {
        show(forwardEntries);
        if (forwardCount === 0) addForwardRow();
      } else {
        hide(forwardEntries);
      }
    });

    // Wire paste textarea
    const pasteArea = $("[data-decline-forward-paste]", root!) as HTMLTextAreaElement | null;
    pasteArea?.addEventListener("change", () => {
      const raw = pasteArea.value.trim();
      if (!raw) return;
      const entries = parseContactText(raw);
      for (const entry of entries) {
        if (forwardCount >= MAX_FORWARDS) break;
        addForwardRow(entry);
      }
      pasteArea.value = "";
    });

    $("[data-add-forward]", root!)?.addEventListener("click", () => addForwardRow());
  }

  function addForwardRow(prefill?: ParsedContact): void {
    if (forwardCount >= MAX_FORWARDS) return;
    forwardCount++;

    const forwardList = $("[data-forward-list]", root!);
    if (!forwardList) return;

    const row = document.createElement("div");
    row.className = "event-flow-invite-row";
    row.dataset.forwardRow = "";
    render(
      <>
        <input
          type="text"
          class="form-control form-control-sm"
          placeholder="First name"
          data-fw="firstName"
          autocomplete="off"
          value={prefill?.firstName ?? ""}
        />
        <input
          type="text"
          class="form-control form-control-sm"
          placeholder="Last name"
          data-fw="lastName"
          autocomplete="off"
          value={prefill?.lastName ?? ""}
        />
        <input
          type="email"
          class="form-control form-control-sm"
          placeholder="Email *"
          data-fw="email"
          autocomplete="off"
          value={prefill?.email ?? ""}
        />
        <button type="button" class="event-flow-invite-remove-btn" aria-label="Remove contact" data-remove-row>
          &times;
        </button>
      </>,
      row,
    );

    row.querySelector("[data-remove-row]")?.addEventListener("click", () => {
      row.remove();
      forwardCount--;
      const addBtn = $("[data-add-forward]", root!);
      if (addBtn) addBtn.removeAttribute("disabled");
    });

    forwardList.appendChild(row);

    const addBtn = $("[data-add-forward]", root!);
    if (forwardCount >= MAX_FORWARDS && addBtn) addBtn.setAttribute("disabled", "");

    if (!prefill) {
      (row.querySelector("[data-fw='firstName']") as HTMLInputElement | null)?.focus();
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function wireSubmit(tok: string, base: string, _info: DeclineInfoValid): void {
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
        reasonError?.classList.remove("d-none");
        formEl.querySelector<HTMLElement>("input[name='reasonCode']")?.focus();
        return;
      }
      reasonError?.classList.add("d-none");

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
        noteError?.classList.remove("d-none");
        ($("[data-reason-note]", root!) as HTMLElement | null)?.focus();
        return;
      }
      noteError?.classList.add("d-none");

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
        const result = await postJson<{ success: boolean; forwarded: string[] }>(
          `${base}/invites/${tok}/decline`,
          payload,
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
