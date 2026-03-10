/**
 * Invite Decline Page
 *
 * Drives the Hugo-managed /invite/decline/ page.
 * Reads ?token= from the URL, fetches invite info, and handles the full
 * decline flow — including virtual-pivot, gap-analysis, NPS, forwarding, and
 * a "parting gift" success state.
 */

interface DeclineInfoValid {
  status: "valid";
  eventName: string | null;
  inviteeFirstName: string | null;
  registrationUrl: string | null;
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

function getText(selector: string): string {
  return ($(`[${selector}]`) as HTMLInputElement | null)?.value?.trim() ?? "";
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json() as T & { error?: { code: string; message: string } };
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string } }).error;
    const e = Object.assign(new Error(err?.message ?? `HTTP ${res.status}`), { code: err?.code ?? "HTTP_ERROR" });
    throw e;
  }
  return body;
}

// ── Initialise ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
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
      info = await apiFetch<DeclineInfo>(`${base}/invites/${tok}/decline-info`);
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
      showStatus("Invitation expired", "This invitation link is no longer valid. Please contact us if you need a new one.");
      return;
    }

    if (info.status === "invalid") {
      showStatus("Invalid invitation link", "This link doesn\u2019t appear to be valid. Please use the link from your original email.");
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

    // Wire registration link for virtual pivot
    if (info.registrationUrl) {
      root!.querySelectorAll<HTMLAnchorElement>("[data-registration-link], [data-registration-link-boss]").forEach((a) => {
        a.href = info.registrationUrl!;
      });
    }

    buildNpsButtons();
    wireReasonRadios(info);
    wireForwardToggle();
    wireSubmit(tok, base, info);

    show(formWrapEl);
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
        isVirtualPivot ? show(virtualPivot) : hide(virtualPivot);
        // On-demand recordings offer (schedule conflict)
        isOnDemand ? show(onDemandPivot) : hide(onDemandPivot);
        // Convince-my-boss variant
        isConvinceBoss ? show(convinceBoss) : hide(convinceBoss);
        // Topic gap analysis
        isTopicGap ? show(topicSuggestion) : hide(topicSuggestion);

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
  const MAX_FORWARDS = parseInt(root!.dataset.forwardMax ?? "", 10) || 10;
  let forwardCount = 0;

  // ── Mini invite-text parser (mirrors render-share-panel.ts#parseInviteText) ─

  interface ForwardEntry { email: string; firstName?: string; lastName?: string }

  function parseForwardText(raw: string): ForwardEntry[] {
    const results: ForwardEntry[] = [];
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // "First Last" <email>  or  First Last <email>
      const angle = line.match(/^"?([^"<>]*)"?\s*<([^>]+)>\s*$/);
      if (angle) {
        const email = angle[2].trim().toLowerCase();
        if (!email.includes("@")) continue;
        const entry: ForwardEntry = { email };
        const parts = angle[1].trim().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) { entry.firstName = parts[0]; entry.lastName = parts.slice(1).join(" "); }
        else if (parts.length === 1) { entry.firstName = parts[0]; }
        results.push(entry);
        continue;
      }
      // CSV: first,last,email
      const csv = line.split(",").map((s) => s.trim());
      if (csv.length === 3 && csv[2].includes("@") && !csv[2].includes(" ")) {
        results.push({ firstName: csv[0] || undefined, lastName: csv[1] || undefined, email: csv[2].toLowerCase() });
        continue;
      }
      // Plain email list (comma/semicolon separated)
      for (const atom of line.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
        if (!atom.includes("@")) continue;
        const dot = atom.split("@")[0].match(/^([a-z]+)\.([a-z]+)$/i);
        const entry: ForwardEntry = { email: atom.toLowerCase() };
        if (dot) {
          entry.firstName = dot[1].charAt(0).toUpperCase() + dot[1].slice(1).toLowerCase();
          entry.lastName = dot[2].charAt(0).toUpperCase() + dot[2].slice(1).toLowerCase();
        }
        results.push(entry);
      }
    }
    return results;
  }

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
      const entries = parseForwardText(raw);
      for (const entry of entries) {
        if (forwardCount >= MAX_FORWARDS) break;
        addForwardRow(entry);
      }
      pasteArea.value = "";
    });

    $("[data-add-forward]", root!)?.addEventListener("click", () => addForwardRow());
  }

  function addForwardRow(prefill?: ForwardEntry): void {
    if (forwardCount >= MAX_FORWARDS) return;
    forwardCount++;

    const forwardList = $("[data-forward-list]", root!);
    if (!forwardList) return;

    const row = document.createElement("div");
    row.className = "event-flow-invite-row";
    row.dataset.forwardRow = "";
    row.innerHTML = `
      <input type="text" class="form-control form-control-sm" placeholder="First name" data-fw="firstName" autocomplete="off">
      <input type="text" class="form-control form-control-sm" placeholder="Last name" data-fw="lastName" autocomplete="off">
      <input type="email" class="form-control form-control-sm" placeholder="Email *" data-fw="email" autocomplete="off">
      <button type="button" class="event-flow-invite-remove-btn" aria-label="Remove contact" data-remove-row>&times;</button>
    `;

    if (prefill) {
      (row.querySelector("[data-fw='firstName']") as HTMLInputElement).value = prefill.firstName ?? "";
      (row.querySelector("[data-fw='lastName']") as HTMLInputElement).value = prefill.lastName ?? "";
      (row.querySelector("[data-fw='email']") as HTMLInputElement).value = prefill.email;
    }

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
            firstName: (row.querySelector<HTMLInputElement>("[data-fw='firstName']"))?.value.trim() || undefined,
            lastName: (row.querySelector<HTMLInputElement>("[data-fw='lastName']"))?.value.trim() || undefined,
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

      const payload: DeclinePayload = { reasonCode };
      if (reasonNote) payload.reasonNote = reasonNote;
      if (($("[data-unsubscribe-future]", root!) as HTMLInputElement | null)?.checked) {
        payload.unsubscribeFuture = true;
      }
      if (npsScore && npsScore >= 1 && npsScore <= 10) payload.npsScore = npsScore;
      if (forwards.length > 0) payload.forwards = forwards;

      const submitBtn = $("[data-submit-btn]", root!);
      if (submitBtn) {
        submitBtn.setAttribute("disabled", "");
        submitBtn.textContent = "Submitting\u2026";
      }

      try {
        const result = await apiFetch<{ success: boolean; forwarded: string[] }>(
          `${base}/invites/${tok}/decline`,
          { method: "POST", body: JSON.stringify(payload) },
        );

        if (result.success) {
          const forwardedMsg = $("[data-success-forwarded]", root!);
          if (forwardedMsg && result.forwarded?.length) {
            forwardedMsg.textContent =
              `We\u2019ve sent an invitation to ${result.forwarded.join(", ")}. We hope to see them there!`;
          }
          hide(formWrapEl);
          show(successEl);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          throw new Error("Submission was not successful");
        }
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code ?? "";
        let msg = "Something went wrong. Please try again.";
        if (code === "INVITE_NOT_ACTIVE") {
          msg = "This invitation has already been accepted or declined.";
        } else if ((err as Error).message) {
          msg = (err as Error).message;
        }
        if (errorBanner) {
          errorBanner.textContent = msg;
          show(errorBanner);
        }
        if (submitBtn) {
          submitBtn.removeAttribute("disabled");
          submitBtn.textContent = "Decline this invitation";
        }
      }
    });
  }
});
