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
import { render } from "preact";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import { IconLinkedIn, IconXTwitter, IconBluesky, IconReddit } from "../../components/icons";
import { parseContactText } from "../invite-parser";
import type { ParsedContact } from "../invite-parser";

export interface SharePanelOptions {
  shareUrl: string;
  eventName: string;
  firstName?: string | null;
  lastName?: string | null;
  manageToken?: string | null;
  eventSlug?: string | null;
}

function nameSlug(firstName?: string | null, lastName?: string | null): string {
  const raw = [firstName, lastName].filter(Boolean).join("-");
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "attendee";
}

const MAX_INVITES = 10;

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

// ── Components ────────────────────────────────────────────────────────────────

function OgBadge({ ogBadgeUrl, eventName, badgeFilename }: {
  ogBadgeUrl: string;
  eventName: string;
  badgeFilename: string;
}) {
  const [loading, setLoading] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) { setLoading(false); return; }
    const hide = () => setLoading(false);
    img.addEventListener("load", hide, { once: true });
    img.addEventListener("error", hide, { once: true });
    return () => { img.removeEventListener("load", hide); img.removeEventListener("error", hide); };
  }, []);

  return (
    <>
      <div class="event-flow-share-og-preview" data-og-badge-container>
        <div class="event-flow-share-og-loading" data-og-badge-loading hidden={!loading}>
          <span class="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true" />
          <span class="text-muted small">Generating badge…</span>
        </div>
        <img
          ref={imgRef}
          src={ogBadgeUrl}
          alt={`Your personal invite badge for ${eventName}`}
          class="event-flow-share-og-img"
          data-og-badge-img
          width={600}
          height={315}
        />
      </div>
      <div class="event-flow-share-og-actions text-center mt-2 mb-1">
        <a
          href={`${ogBadgeUrl}?download=1&name=${encodeURIComponent(badgeFilename)}`}
          download={badgeFilename}
          class="btn btn-sm btn-outline-secondary"
          aria-label="Download your personal badge image"
        >⬇ Download badge</a>
      </div>
    </>
  );
}

function CopyLinkRow({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl).then(
      () => { setCopied(true); setTimeout(() => setCopied(null), 2000); },
      () => { setCopied(false); },
    );
  }, [shareUrl]);

  return (
    <div class="event-flow-share-link-row">
      <input
        type="text"
        class="form-control form-control-sm event-flow-share-link-input"
        value={shareUrl}
        readOnly
        aria-label="Your unique sharing link"
      />
      <button type="button" class="btn btn-outline-secondary btn-sm event-flow-share-copy-btn" onClick={handleCopy} data-share-copy aria-label="Copy sharing link">
        {copied === true ? "Copied!" : copied === false ? "Copy failed" : "Copy link"}
      </button>
    </div>
  );
}

function SocialLinks({ linkedinUrl, twitterUrl, blueskyUrl, redditUrl }: {
  linkedinUrl: string;
  twitterUrl: string;
  blueskyUrl: string;
  redditUrl: string;
}) {
  return (
    <div class="event-flow-share-socials">
      <span class="event-flow-share-socials-label">Share on:</span>
      <a href={twitterUrl} target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-secondary event-flow-share-social-btn" aria-label="Share on X / Twitter">
        <IconXTwitter />X
      </a>
      <a href={blueskyUrl} target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-secondary event-flow-share-social-btn" aria-label="Share on Bluesky">
        <IconBluesky />Bluesky
      </a>
      <a href={redditUrl} target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-secondary event-flow-share-social-btn" aria-label="Share on Reddit">
        <IconReddit />Reddit
      </a>
    </div>
  );
}

// ── Invite row ──────────────────────────────────────────────────────────────

interface InviteRowData {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
}

function InviteRow({ row, showRemove, onChange, onRemove, onPasteEmail }: {
  row: InviteRowData;
  showRemove: boolean;
  onChange: (id: number, field: keyof Omit<InviteRowData, "id">, value: string) => void;
  onRemove: (id: number) => void;
  onPasteEmail: (id: number, text: string) => void;
}) {
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (!pasted.includes("<") && !pasted.includes(",") && !pasted.includes("\n")) return;
    e.preventDefault();
    onPasteEmail(row.id, pasted);
  }, [row.id, onPasteEmail]);

  return (
    <div class="event-flow-invite-row">
      <input
        type="text"
        class="form-control form-control-sm"
        placeholder="First (opt.)"
        value={row.firstName}
        onInput={(e) => onChange(row.id, "firstName", (e.target as HTMLInputElement).value)}
        aria-label="First name (optional)"
        autocomplete="off"
      />
      <input
        type="text"
        class="form-control form-control-sm"
        placeholder="Last (opt.)"
        value={row.lastName}
        onInput={(e) => onChange(row.id, "lastName", (e.target as HTMLInputElement).value)}
        aria-label="Last name (optional)"
        autocomplete="off"
      />
      <input
        type="email"
        class="form-control form-control-sm"
        placeholder="colleague@example.com"
        value={row.email}
        onInput={(e) => onChange(row.id, "email", (e.target as HTMLInputElement).value)}
        onPaste={handlePaste}
        aria-label="Email address"
        autocomplete="off"
      />
      {showRemove && (
        <button type="button" class="event-flow-invite-remove-btn" onClick={() => onRemove(row.id)} aria-label="Remove row">
          ×
        </button>
      )}
    </div>
  );
}

// ── Invite panel ────────────────────────────────────────────────────────────

let nextRowId = 1;
function makeRow(entry?: ParsedContact): InviteRowData {
  return {
    id: nextRowId++,
    email: entry?.email ?? "",
    firstName: entry?.firstName ?? "",
    lastName: entry?.lastName ?? "",
  };
}

function InvitePanel({ manageToken, eventSlug }: { manageToken: string; eventSlug: string }) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<InviteRowData[]>(() => [makeRow()]);
  const [status, setStatus] = useState<{ message: string; type: "success" | "danger" } | null>(null);
  const [sending, setSending] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);

  const showRemove = rows.length > 1;

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      if (!prev) {
        setTimeout(() => fieldsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      }
      return !prev;
    });
  }, []);

  const updateRow = useCallback((id: number, field: keyof Omit<InviteRowData, "id">, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
    setStatus(null);
  }, []);

  const removeRow = useCallback((id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addRow = useCallback((entry?: ParsedContact) => {
    setRows((prev) => {
      if (prev.length >= MAX_INVITES) return prev;
      return [...prev, makeRow(entry)];
    });
  }, []);

  const handlePasteEmail = useCallback((rowId: number, text: string) => {
    const entries = parseContactText(text);
    if (!entries.length) return;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], email: entries[0].email, firstName: entries[0].firstName ?? "", lastName: entries[0].lastName ?? "" };
      for (const entry of entries.slice(1)) {
        if (updated.length >= MAX_INVITES) break;
        updated.push(makeRow(entry));
      }
      return updated;
    });
  }, []);

  const handlePasteArea = useCallback((e: ClipboardEvent) => {
    setTimeout(() => {
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;
      if (!text.trim()) return;
      const entries = parseContactText(text);
      if (!entries.length) return;

      setRows((prev) => {
        const updated = [...prev];
        let entryIdx = 0;
        // Fill existing empty rows first
        for (let i = 0; i < updated.length && entryIdx < entries.length; i++) {
          if (!updated[i].email.trim()) {
            updated[i] = { ...updated[i], email: entries[entryIdx].email, firstName: entries[entryIdx].firstName ?? "", lastName: entries[entryIdx].lastName ?? "" };
            entryIdx++;
          }
        }
        // Add remaining as new rows
        for (; entryIdx < entries.length && updated.length < MAX_INVITES; entryIdx++) {
          updated.push(makeRow(entries[entryIdx]));
        }
        return updated;
      });
      textarea.value = "";
    }, 0);
  }, []);

  const handleSend = useCallback(async () => {
    const invites = rows
      .map((r) => ({ email: r.email.trim(), firstName: r.firstName.trim() || undefined, lastName: r.lastName.trim() || undefined }))
      .filter((i) => i.email);

    if (!invites.length) {
      setStatus({ message: "Please enter at least one email address.", type: "danger" });
      return;
    }
    const badEmail = invites.find((i) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email));
    if (badEmail) {
      setStatus({ message: `"${badEmail.email}" doesn't look like a valid email address.`, type: "danger" });
      return;
    }

    setSending(true);
    setStatus(null);

    try {
      const response = await fetch(`/api/v1/events/${eventSlug}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${manageToken}` },
        body: JSON.stringify({ invites }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        const msg = ((data?.error as Record<string, unknown>)?.message as string | undefined) ?? "Something went wrong. Please try again.";
        setStatus({ message: msg, type: "danger" });
        return;
      }
      const count = (data?.created as unknown[])?.length ?? invites.length;
      setStatus({ message: `✓ Sent ${count} invitation${count !== 1 ? "s" : ""}! They'll receive a registration link shortly.`, type: "success" });
      setRows([makeRow()]);
    } catch {
      setStatus({ message: "Could not send invites. Please try again later.", type: "danger" });
    } finally {
      setSending(false);
    }
  }, [rows, eventSlug, manageToken]);

  return (
    <div class="event-flow-invite" data-invite-panel>
      <button
        type="button"
        class="btn btn-outline-secondary event-flow-share-primary-btn"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="event-flow-invite-fields"
        data-invite-toggle
      >✉️ Invite by email</button>

      <div id="event-flow-invite-fields" class="event-flow-invite-fields" hidden={!expanded} ref={fieldsRef} data-invite-fields>
        <p class="event-flow-invite-copy">
          We'll send a personal invitation on your behalf — they'll receive a direct registration link.
          Paste a list below or fill in rows one by one.
        </p>
        <div class="event-flow-invite-paste-zone">
          <textarea
            class="form-control form-control-sm"
            rows={2}
            placeholder={"alice@example.net\nBob Smith <bob@example.com>\ncarol.jones@co.example…"}
            aria-label="Paste email addresses to add"
            onPaste={handlePasteArea}
          />
          <p class="event-flow-invite-paste-hint">Names inferred from dotted addresses or &ldquo;Name &lt;email&gt;&rdquo; format.</p>
        </div>
        <div class="event-flow-invite-thead" aria-hidden="true">
          <span>First name</span>
          <span>Last name</span>
          <span>Email *</span>
          <span />
        </div>
        <div class="event-flow-invite-list" data-invite-list>
          {rows.map((row) => (
            <InviteRow
              key={row.id}
              row={row}
              showRemove={showRemove}
              onChange={updateRow}
              onRemove={removeRow}
              onPasteEmail={handlePasteEmail}
            />
          ))}
        </div>
        <div class="event-flow-invite-actions mt-2 d-flex gap-2 flex-wrap align-items-center">
          {rows.length < MAX_INVITES && (
            <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => addRow()} data-invite-add>+ Add row</button>
          )}
          <button type="button" class="btn btn-sm btn-page-accent" onClick={handleSend} disabled={sending} data-invite-send>
            {sending ? "Sending…" : "Send invites"}
          </button>
        </div>
        {status && (
          <p class={`event-flow-invite-status mt-2 small text-${status.type}`} data-invite-status aria-live="polite">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main share panel ────────────────────────────────────────────────────────

function SharePanelInner({ options }: { options: SharePanelOptions }) {
  const { shareUrl, eventName, manageToken, eventSlug } = options;

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

  return (
    <div class="event-flow-share">
      {ogBadgeUrl && (
        <OgBadge ogBadgeUrl={ogBadgeUrl} eventName={eventName} badgeFilename={badgeFilename} />
      )}

      <p class="event-flow-share-heading">Invite a colleague — seats are limited</p>
      <p class="event-flow-share-copy">
        In-person spots fill fast. Every registration through your personal link
        helps us prioritise attendees and shape the programme.
      </p>

      <div class="event-flow-share-ctas">
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-page-accent event-flow-share-primary-btn"
          aria-label="Share on LinkedIn"
        >
          <IconLinkedIn />Share on LinkedIn
        </a>
        {canInvite && (
          <InvitePanel manageToken={manageToken as string} eventSlug={eventSlug as string} />
        )}
      </div>

      <CopyLinkRow shareUrl={shareUrl} />
      <SocialLinks linkedinUrl={linkedinUrl} twitterUrl={twitterUrl} blueskyUrl={blueskyUrl} redditUrl={redditUrl} />
    </div>
  );
}

export function renderSharePanel(container: HTMLElement, options: SharePanelOptions): void {
  render(<SharePanelInner options={options} />, container);
}

/**
 * Busts the R2 cache on the OG badge image inside a share panel and shows the
 * loading spinner until the freshly-rendered PNG arrives.
 */
export function refreshSharePanelBadge(panelContainer: HTMLElement): void {
  const img = panelContainer.querySelector<HTMLImageElement>("[data-og-badge-img]");
  const loader = panelContainer.querySelector<HTMLElement>("[data-og-badge-loading]");
  if (!img) return;

  const baseUrl = img.src.split("?")[0];
  if (loader) loader.hidden = false;

  const hideLoader = (): void => { if (loader) loader.hidden = true; };
  img.addEventListener("load", hideLoader, { once: true });
  img.addEventListener("error", hideLoader, { once: true });
  img.src = `${baseUrl}?t=${Date.now()}`;
}
