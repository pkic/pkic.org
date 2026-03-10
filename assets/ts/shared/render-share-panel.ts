/**
 * Renders a personalised sharing panel into a container element.
 *
 * Psychology applied:
 *  - Peak-End Rule: presenting the share prompt at the successful conclusion
 *    makes it the most memorable moment of the registration flow.
 *  - Reciprocity: we thank the registrant and reward them with their unique
 *    link before asking them to spread the word.
 *  - Social Proof + Mimetic Desire: the copy positions sharing as the natural
 *    next step that peers take.
 *  - Goal-Gradient: completing registration unlocks the "invite" privilege,
 *    giving registrants a sense of forward momentum.
 *  - Endowment Effect: showing the OG badge image makes the share link feel
 *    personally owned — registrants are more likely to share something that
 *    already has their name on it.
 */
export interface SharePanelOptions {
  shareUrl: string;
  eventName: string;
  /** Shown in the panel heading, e.g. "Alice" */
  firstName?: string | null;
  lastName?: string | null;
  /** Registration manage token — when present, activates the invite-by-email section. */
  manageToken?: string | null;
  /** Event slug — required alongside manageToken to POST invites. */
  eventSlug?: string | null;
}

/** Produces a URL-safe slug from a full name, e.g. "Paul van Brouwershaven" → "paul-van-brouwershaven" */
function nameSlug(firstName?: string | null, lastName?: string | null): string {
  const raw = [firstName, lastName].filter(Boolean).join("-");
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "attendee";
}

const MAX_INVITES = 10;

// ── Invite parser ─────────────────────────────────────────────────────────────

interface InviteEntry {
  email: string;
  firstName?: string;
  lastName?: string;
}

function capitalizeWord(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Parses freeform text into invite entries.
 * Supports:
 *   - Plain email:          alice@example.com
 *   - Dotted email hint:    alice.smith@example.com  → firstName=Alice, lastName=Smith
 *   - RFC-5322-ish name:    Alice Smith <alice@example.com>
 *   - Quoted name:          "Alice Smith" <alice@example.com>
 *   - CSV rows:             Alice,Smith,alice@example.com
 * Multiple entries may be separated by newlines; commas/semicolons within a
 * single entry are fine as long as angle-brackets delimit the email.
 */
function parseInviteText(raw: string): InviteEntry[] {
  const results: InviteEntry[] = [];
  // Split by newlines first, then handle comma/semicolon separated plain emails
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Format: "First Last" <email>  or  First Last <email>
    const angleBracket = line.match(/^"?([^"<>]*)"?\s*<([^>]+)>\s*$/);
    if (angleBracket) {
      const namePart = angleBracket[1].trim();
      const email = angleBracket[2].trim().toLowerCase();
      if (!email.includes("@")) continue;
      const entry: InviteEntry = { email };
      if (namePart) {
        const parts = namePart.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
          entry.firstName = parts[0];
          entry.lastName = parts.slice(1).join(" ");
        } else if (parts.length === 1) {
          entry.firstName = parts[0];
        }
      }
      results.push(entry);
      continue;
    }

    // CSV: three comma-separated values where last looks like an email
    const csvParts = line.split(",").map((s) => s.trim());
    if (
      csvParts.length === 3 &&
      csvParts[2].includes("@") &&
      !csvParts[2].includes(" ")
    ) {
      results.push({
        firstName: csvParts[0] || undefined,
        lastName: csvParts[1] || undefined,
        email: csvParts[2].toLowerCase(),
      });
      continue;
    }

    // Fall through: split by commas/semicolons for plain email lists
    const atoms = line.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    for (const atom of atoms) {
      if (!atom.includes("@")) continue;
      const entry: InviteEntry = { email: atom.toLowerCase() };
      // Derive name from dotted local-part: alice.smith@example.com
      const local = atom.split("@")[0];
      const dotParts = local.split(".").filter(Boolean);
      if (dotParts.length >= 2) {
        entry.firstName = capitalizeWord(dotParts[0]);
        entry.lastName = capitalizeWord(dotParts.slice(1).join(" "));
      }
      results.push(entry);
    }
  }

  // De-duplicate by email (case-insensitive, keep first occurrence)
  const seen = new Set<string>();
  return results.filter((e) => {
    if (seen.has(e.email)) return false;
    seen.add(e.email);
    return true;
  });
}

/** Extract the referral code from a share URL like https://pkic.org/r/ABC123 */
function extractOgBadgeUrl(shareUrl: string): string | null {
  try {
    const match = shareUrl.match(/\/r\/([A-Za-z0-9]+)(?:[?#]|$)/);
    if (!match) return null;
    const origin = new URL(shareUrl).origin;
    return `${origin}/api/v1/og/${match[1]}`;
  } catch {
    return null;
  }
}

export function renderSharePanel(container: HTMLElement, options: SharePanelOptions): void {
  const { shareUrl, eventName, firstName, manageToken, eventSlug } = options;

  const shareText = `I just registered for ${eventName} — join me!`;
  const twitterText = encodeURIComponent(`${shareText} ${shareUrl}`);
  const blueskyText = encodeURIComponent(`${shareText}\n${shareUrl}`);
  const redditTitle = encodeURIComponent(`Join me at ${eventName}`);

  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  const twitterUrl  = `https://twitter.com/intent/tweet?text=${twitterText}`;
  const blueskyUrl  = `https://bsky.app/intent/compose?text=${blueskyText}`;
  const redditUrl   = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${redditTitle}`;
  const ogBadgeUrl  = extractOgBadgeUrl(shareUrl);
  const badgeFilename = `attendee-badge-${nameSlug(options.firstName, options.lastName)}.png`;

  const canInvite = Boolean(manageToken && eventSlug);

  // ── Brand icons (letterform-only — no bounding boxes, render cleanly on any button colour) ──
  const iconLinkedIn = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true" focusable="false" class="me-2" style="flex-shrink:0"><path d="M6.94 5a2 2 0 1 1-4-.002 2 2 0 0 1 4 .002zM7 8.48H3V21h4V8.48zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91l.04-1.68z"/></svg>`;
  const iconX        = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true" focusable="false" class="me-1" style="flex-shrink:0"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.736-8.856L1.254 2.25H8.08l4.257 5.626L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
  const iconBluesky  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 568 501" fill="currentColor" width="14" height="14" aria-hidden="true" focusable="false" class="me-1" style="flex-shrink:0"><path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.209C491.866-1.611 568-28.906 568 57.954c0 17.976-10.312 151.124-16.366 172.834-21.009 75.3-97.519 94.434-165.559 82.737C521.813 339.48 540.304 401.245 486.201 463c-105.883 108.893-152.134-27.269-164.013-62.132-5.216-14.818-7.671-21.816-8.188-21.816s-2.972 7-8.188 21.816C293.933 435.731 247.682 571.893 141.799 463c-54.103-61.755-35.612-123.52 99.126-149.475-68.04 11.697-144.55-7.437-165.559-82.737C69.312 209.078 59 75.93 59 57.954 59-28.906 135.134-1.611 123.121 33.664z"/></svg>`;
  const iconReddit   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true" focusable="false" class="me-1" style="flex-shrink:0"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`;

  container.innerHTML = `
    <div class="event-flow-share">

      ${ogBadgeUrl ? `
      <div class="event-flow-share-og-preview" data-og-badge-container style="position:relative">
        <div data-og-badge-loading style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:.5rem;background:rgba(255,255,255,.85);border-radius:.5rem;z-index:1">
          <span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span>
          <span class="text-muted small">Generating badge…</span>
        </div>
        <img
          src="${escapeHtml(ogBadgeUrl)}"
          alt="Your personal invite badge for ${escapeHtml(eventName)}"
          class="event-flow-share-og-img"
          data-og-badge-img
          width="600"
          height="315"
        />
      </div>
      <div class="event-flow-share-og-actions text-center mt-2 mb-1">
        <a
          href="${escapeHtml(ogBadgeUrl)}?download=1&name=${encodeURIComponent(badgeFilename)}"
          download="${escapeHtml(badgeFilename)}"
          class="btn btn-sm btn-outline-secondary"
          aria-label="Download your personal badge image"
        >⬇ Download badge</a>
      </div>
      ` : ""}

      <p class="event-flow-share-heading">Invite a colleague — seats are limited</p>
      <p class="event-flow-share-copy">
        In-person spots fill fast. Every registration through your personal link
        helps us prioritise attendees and shape the programme.
      </p>

      <div class="event-flow-share-ctas">
        <a
          href="${linkedinUrl}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-page-accent event-flow-share-primary-btn"
          aria-label="Share on LinkedIn"
        >${iconLinkedIn}Share on LinkedIn</a>${canInvite ? `
        <button
          type="button"
          class="btn btn-outline-secondary event-flow-share-primary-btn"
          data-invite-toggle
          aria-expanded="false"
          aria-controls="event-flow-invite-fields"
        >✉️ Invite by email</button>` : ""}
      </div>

      <div class="event-flow-share-link-row">
        <input
          type="text"
          class="form-control form-control-sm event-flow-share-link-input"
          value="${escapeHtml(shareUrl)}"
          readonly
          aria-label="Your unique sharing link"
        >
        <button
          type="button"
          class="btn btn-outline-secondary btn-sm event-flow-share-copy-btn"
          data-share-copy
          aria-label="Copy sharing link"
        >Copy link</button>
      </div>

      <div class="event-flow-share-socials">
        <span class="event-flow-share-socials-label">Share on:</span>
        <a href="${twitterUrl}" target="_blank" rel="noopener noreferrer"
          class="btn btn-sm btn-outline-secondary event-flow-share-social-btn"
          aria-label="Share on X / Twitter">${iconX}X</a>
        <a href="${blueskyUrl}" target="_blank" rel="noopener noreferrer"
          class="btn btn-sm btn-outline-secondary event-flow-share-social-btn"
          aria-label="Share on Bluesky">${iconBluesky}Bluesky</a>
        <a href="${redditUrl}" target="_blank" rel="noopener noreferrer"
          class="btn btn-sm btn-outline-secondary event-flow-share-social-btn"
          aria-label="Share on Reddit">${iconReddit}Reddit</a>
      </div>

      ${canInvite ? `
      <div class="event-flow-invite" data-invite-panel>
        <div id="event-flow-invite-fields" class="event-flow-invite-fields" hidden data-invite-fields>
          <p class="event-flow-invite-copy">
            We'll send a personal invitation on your behalf — they'll receive a direct registration link.
            Paste a list below or fill in rows one by one.
          </p>
        <div class="event-flow-invite-paste-zone">
          <textarea
            class="form-control form-control-sm"
            data-invite-paste
            rows="2"
            placeholder="alice@example.net\nBob Smith &lt;bob@example.com&gt;\ncarol.jones@co.example…"
            aria-label="Paste email addresses to add"
          ></textarea>
          <p class="event-flow-invite-paste-hint">Names inferred from dotted addresses or &ldquo;Name &lt;email&gt;&rdquo; format.</p>
        </div>
        <div class="event-flow-invite-thead" aria-hidden="true">
          <span>First name</span>
          <span>Last name</span>
          <span>Email *</span>
          <span></span>
        </div>
        <div class="event-flow-invite-list" data-invite-list>
          <div class="event-flow-invite-row">
            <input type="text" class="form-control form-control-sm" placeholder="First (opt.)" data-invite-first aria-label="First name (optional)" autocomplete="off" />
            <input type="text" class="form-control form-control-sm" placeholder="Last (opt.)" data-invite-last aria-label="Last name (optional)" autocomplete="off" />
            <input type="email" class="form-control form-control-sm" placeholder="colleague@example.com" data-invite-email aria-label="Email address" autocomplete="off" />
            <button type="button" class="event-flow-invite-remove-btn" data-invite-remove aria-label="Remove row" hidden>×</button>
          </div>
        </div>
        <div class="event-flow-invite-actions mt-2 d-flex gap-2 flex-wrap align-items-center">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-invite-add>+ Add row</button>
          <button type="button" class="btn btn-sm btn-page-accent" data-invite-send>Send invites</button>
        </div>
          <p class="event-flow-invite-status mt-2 small" data-invite-status aria-live="polite"></p>
        </div>
      </div>
      ` : ""}
    </div>
  `;

  // ── OG badge loading state — hide spinner once image resolves ──────────────
  const badgeImg = container.querySelector<HTMLImageElement>("[data-og-badge-img]");
  const badgeLoader = container.querySelector<HTMLElement>("[data-og-badge-loading]");
  if (badgeImg && badgeLoader) {
    const hideLoader = (): void => { badgeLoader.style.display = "none"; };
    if (badgeImg.complete) {
      hideLoader();
    } else {
      badgeImg.addEventListener("load", hideLoader, { once: true });
      badgeImg.addEventListener("error", hideLoader, { once: true });
    }
  }

  // ── Copy-to-clipboard ──────────────────────────────────────────────────────
  const copyBtn = container.querySelector<HTMLButtonElement>("[data-share-copy]");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(shareUrl).then(
        () => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy link";
          }, 2000);
        },
        () => {
          copyBtn.textContent = "Copy failed";
        },
      );
    });
  }

  // ── Invite-by-email system ─────────────────────────────────────────────────
  if (canInvite) {
    // The invite toggle is now rendered as a primary CTA button rather than
    // a text-link inside the invite panel — wire it up from the CTA row.
    const toggleBtn = container.querySelector<HTMLButtonElement>("[data-invite-toggle]");
    const fieldsEl  = container.querySelector<HTMLElement>("[data-invite-fields]");
    if (toggleBtn && fieldsEl) {
      toggleBtn.addEventListener("click", () => {
        const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
        toggleBtn.setAttribute("aria-expanded", String(!expanded));
        fieldsEl.hidden = expanded;
        // Keep the panel visible by scrolling the invite section into view
        if (!expanded) {
          setTimeout(() => fieldsEl.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
        }
      });
    }

    installInviteSystem(container, {
      manageToken: manageToken as string,
      eventSlug: eventSlug as string,
    });
  }
}

// ── Invite system ──────────────────────────────────────────────────────────────

function installInviteSystem(
  container: HTMLElement,
  { manageToken, eventSlug }: { manageToken: string; eventSlug: string },
): void {
  const list = container.querySelector<HTMLElement>("[data-invite-list]");
  const addBtn = container.querySelector<HTMLButtonElement>("[data-invite-add]");
  const sendBtn = container.querySelector<HTMLButtonElement>("[data-invite-send]");
  const statusEl = container.querySelector<HTMLElement>("[data-invite-status]");
  const pasteArea = container.querySelector<HTMLTextAreaElement>("[data-invite-paste]");

  if (!list || !addBtn || !sendBtn || !statusEl) return;

  /** Show/hide remove buttons based on row count; hide Add when at limit. */
  function syncRowControls(): void {
    const rows = list!.querySelectorAll<HTMLElement>(".event-flow-invite-row");
    rows.forEach((row) => {
      const removeBtn = row.querySelector<HTMLButtonElement>("[data-invite-remove]");
      if (removeBtn) removeBtn.hidden = rows.length <= 1;
    });
    if (addBtn) addBtn.hidden = rows.length >= MAX_INVITES;
  }

  function makeRowHtml(entry?: InviteEntry): string {
    return `
      <input type="text" class="form-control form-control-sm" placeholder="First (opt.)" data-invite-first
        aria-label="First name (optional)" autocomplete="off" value="${escapeHtml(entry?.firstName ?? "")}" />
      <input type="text" class="form-control form-control-sm" placeholder="Last (opt.)" data-invite-last
        aria-label="Last name (optional)" autocomplete="off" value="${escapeHtml(entry?.lastName ?? "")}" />
      <input type="email" class="form-control form-control-sm" placeholder="colleague@example.com" data-invite-email
        aria-label="Email address" autocomplete="off" value="${escapeHtml(entry?.email ?? "")}" />
      <button type="button" class="event-flow-invite-remove-btn" data-invite-remove
        aria-label="Remove row">×</button>
    `;
  }

  function wireRow(row: HTMLElement): void {
    row.querySelector<HTMLButtonElement>("[data-invite-remove]")?.addEventListener("click", () => {
      row.remove();
      syncRowControls();
    });

    // Inline paste detection: if user pastes "Name <email>" into the email field
    row.querySelector<HTMLInputElement>("[data-invite-email]")?.addEventListener("paste", (e) => {
      const pasted = e.clipboardData?.getData("text") ?? "";
      if (!pasted.includes("<") && !pasted.includes(",") && !pasted.includes("\n")) return;
      e.preventDefault();
      const entries = parseInviteText(pasted);
      if (!entries.length) return;

      // Fill the current row with the first entry, add extra rows for the rest
      const firstEl = row.querySelector<HTMLInputElement>("[data-invite-first]");
      const lastEl = row.querySelector<HTMLInputElement>("[data-invite-last]");
      const emailEl = row.querySelector<HTMLInputElement>("[data-invite-email]");
      if (firstEl) firstEl.value = entries[0].firstName ?? "";
      if (lastEl) lastEl.value = entries[0].lastName ?? "";
      if (emailEl) emailEl.value = entries[0].email;

      for (const entry of entries.slice(1)) {
        addRow(entry);
      }
    });
  }

  function addRow(entry?: InviteEntry): void {
    const rows = list!.querySelectorAll(".event-flow-invite-row");
    if (rows.length >= MAX_INVITES) return;
    const row = document.createElement("div");
    row.className = "event-flow-invite-row";
    row.innerHTML = makeRowHtml(entry);
    wireRow(row);
    list!.appendChild(row);
    syncRowControls();
    if (!entry) {
      row.querySelector<HTMLInputElement>("[data-invite-first]")?.focus();
    }
  }

  // Wire the first (pre-rendered) row
  const firstRow = list.querySelector<HTMLElement>(".event-flow-invite-row");
  if (firstRow) wireRow(firstRow);

  addBtn.addEventListener("click", () => addRow());

  // ── Paste area: auto-parse on input ─────────────────────────────────────────
  if (pasteArea) {
    pasteArea.addEventListener("paste", () => {
      // Use setTimeout so the value is available after paste
      setTimeout(() => {
        const text = pasteArea.value;
        if (!text.trim()) return;
        const entries = parseInviteText(text);
        if (!entries.length) return;

        // Fill existing empty rows first, then add new ones
        const existingRows = Array.from(list!.querySelectorAll<HTMLElement>(".event-flow-invite-row"));
        let entryIdx = 0;
        for (const row of existingRows) {
          if (entryIdx >= entries.length) break;
          const emailEl = row.querySelector<HTMLInputElement>("[data-invite-email]");
          if (emailEl && !emailEl.value.trim()) {
            const firstEl = row.querySelector<HTMLInputElement>("[data-invite-first]");
            const lastEl = row.querySelector<HTMLInputElement>("[data-invite-last]");
            if (firstEl) firstEl.value = entries[entryIdx].firstName ?? "";
            if (lastEl) lastEl.value = entries[entryIdx].lastName ?? "";
            emailEl.value = entries[entryIdx].email;
            entryIdx++;
          }
        }
        // Add remaining as new rows
        for (; entryIdx < entries.length; entryIdx++) {
          addRow(entries[entryIdx]);
        }

        pasteArea.value = "";
        syncRowControls();
      }, 0);
    });
  }

  sendBtn.addEventListener("click", async () => {
    const rows = Array.from(list!.querySelectorAll<HTMLElement>(".event-flow-invite-row"));
    const invites = rows
      .map((row) => ({
        email: (row.querySelector<HTMLInputElement>("[data-invite-email]")?.value ?? "").trim(),
        firstName: (row.querySelector<HTMLInputElement>("[data-invite-first]")?.value ?? "").trim() || undefined,
        lastName: (row.querySelector<HTMLInputElement>("[data-invite-last]")?.value ?? "").trim() || undefined,
      }))
      .filter((i) => i.email);

    if (!invites.length) {
      showStatus("Please enter at least one email address.", "danger");
      return;
    }
    const badEmail = invites.find((i) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email));
    if (badEmail) {
      showStatus(`“${badEmail.email}” doesn’t look like a valid email address.`, "danger");
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    clearStatus();

    try {
      const response = await fetch(`/api/v1/events/${eventSlug}/invites`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${manageToken}`,
        },
        body: JSON.stringify({ invites }),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        const msg =
          ((data?.error as Record<string, unknown>)?.message as string | undefined) ??
          "Something went wrong. Please try again.";
        showStatus(msg, "danger");
        return;
      }

      const count = (data?.created as unknown[])?.length ?? invites.length;
      showStatus(
        `✓ Sent ${count} invitation${count !== 1 ? "s" : ""}! They’ll receive a registration link shortly.`,
        "success",
      );
      // Clear all rows to a single empty row
      list!.innerHTML = "";
      addRow();
      syncRowControls();
    } catch {
      showStatus("Could not send invites. Please try again later.", "danger");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send invites";
    }
  });

  function showStatus(message: string, type: "success" | "danger"): void {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `event-flow-invite-status mt-2 small text-${type}`;
  }

  function clearStatus(): void {
    if (!statusEl) return;
    statusEl.textContent = "";
    statusEl.className = "event-flow-invite-status mt-2 small";
  }

  syncRowControls();
}

/**
 * Busts the R2 cache on the OG badge image inside a share panel and shows the
 * loading spinner until the freshly-rendered PNG arrives.  Call this after the
 * user updates their headshot so the panel reflects the regenerated badge.
 */
export function refreshSharePanelBadge(panelContainer: HTMLElement): void {
  const img = panelContainer.querySelector<HTMLImageElement>("[data-og-badge-img]");
  const loader = panelContainer.querySelector<HTMLElement>("[data-og-badge-loading]");
  if (!img) return;

  const baseUrl = img.src.split("?")[0];
  if (loader) loader.style.display = "";

  const hideLoader = (): void => { if (loader) loader.style.display = "none"; };
  img.addEventListener("load", hideLoader, { once: true });
  img.addEventListener("error", hideLoader, { once: true });
  img.src = `${baseUrl}?t=${Date.now()}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
