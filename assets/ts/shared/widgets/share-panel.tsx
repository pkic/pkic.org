/**
 * Renders a personalized sharing panel into a container element.
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
 *    already has their name on it, so the badge leads the panel.
 *
 * Design system notes (phase 5):
 *  - The surface is a `Panel`, so its frame, ground and padding come from the
 *    system rather than from `.event-flow-share` in `assets/scss`, whose rules
 *    for this panel are now unreferenced. It renders
 *    inside `SuccessPanel`, which centers its children, hence `pk-start`.
 *  - Every invite row control carries its own label. The version this replaces
 *    had one `aria-hidden` header strip and three `aria-label`s per row, so a
 *    reader tabbing through ten rows heard "Email address" ten times with no
 *    way to tell which row they were in.
 *  - The copy-link outcome is a `role="status"` line rather than a relabelled
 *    button: changing a control's accessible name under the reader's cursor
 *    moves the goalposts mid-interaction.
 */
import { render } from "preact";
import { useState, useCallback, useId, useRef, useEffect } from "preact/hooks";
import { IconLinkedIn, IconXTwitter, IconBluesky, IconReddit } from "../../components/icons";
import { parseContactText } from "../invite-parser";
import type { ParsedContact } from "../invite-parser";
import { registrationInviteCreateSchema, peerInviteResultSchema } from "../../../shared/schemas/registration";
import { postJson, ApiClientError } from "../api-client";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { Spinner } from "../../ui/Spinner";
import { TextInput, Textarea } from "../../ui/TextControl";
// `pk-mono` and `pk-framed` are written as class names here rather than
// reached through a component, so this module has to pull their stylesheet
// into its own chunk.
import "../../ui/Content.css";

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
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "attendee"
  );
}

const MAX_INVITES = 10;

function extractOgBadgeUrl(shareUrl: string): string | null {
  try {
    const match = shareUrl.match(/\/r\/([A-Za-z0-9]+)(?:[?#]|$)/);
    if (!match) return null;
    const origin = new URL(shareUrl).origin;
    return `${origin}/api/v1/registrations/referrals/${match[1]}/badge`;
  } catch {
    return null;
  }
}

// ── Components ────────────────────────────────────────────────────────────────

function OgBadge({
  ogBadgeUrl,
  eventName,
  badgeFilename,
}: {
  ogBadgeUrl: string;
  eventName: string;
  badgeFilename: string;
}) {
  const [loading, setLoading] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      setLoading(false);
      return;
    }
    const hide = () => setLoading(false);
    img.addEventListener("load", hide, { once: true });
    img.addEventListener("error", hide, { once: true });
    return () => {
      img.removeEventListener("load", hide);
      img.removeEventListener("error", hide);
    };
  }, []);

  return (
    <div class="pk-stack pk-stack--tight">
      {/* The indicator sits above the picture rather than over it: an overlay
          would need an absolutely positioned box, and the system has no
          utility for one. Spinner carries its own role="status", so the wait
          is announced instead of being a silent grey rectangle. */}
      <div class="pk-cluster pk-cluster--center" data-og-badge-loading hidden={!loading}>
        <Spinner size="sm" label="Generating your badge…" />
      </div>
      <img
        ref={imgRef}
        src={ogBadgeUrl}
        alt={`Your personal invite badge for ${eventName}`}
        class="pk-framed"
        data-og-badge-img
        width={600}
        height={315}
      />
      <div class="pk-cluster pk-cluster--center">
        <a
          href={`${ogBadgeUrl}?download=1&name=${encodeURIComponent(badgeFilename)}`}
          download={badgeFilename}
          class="pk-btn pk-btn--secondary pk-btn--sm"
        >
          <span aria-hidden="true">⬇</span> Download badge
        </a>
      </div>
    </div>
  );
}

function CopyLinkRow({ shareUrl }: { shareUrl: string }) {
  const [copyStatus, setCopyStatus] = useState("");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl).then(
      () => setCopyStatus("Link copied to your clipboard."),
      () => setCopyStatus("Could not copy automatically — select the link above and copy it."),
    );
  }, [shareUrl]);

  return (
    <div class="pk-stack pk-stack--snug">
      <Field label="Your unique sharing link" help="Registrations made through this link are credited to you.">
        {(control) => <TextInput {...control} class="pk-mono" value={shareUrl} readOnly />}
      </Field>
      <div class="pk-cluster">
        <Button size="sm" onClick={handleCopy}>
          Copy link
        </Button>
        <p class="pk-small" role="status">
          {copyStatus}
        </p>
      </div>
    </div>
  );
}

function SocialLinks({
  twitterUrl,
  blueskyUrl,
  redditUrl,
}: {
  twitterUrl: string;
  blueskyUrl: string;
  redditUrl: string;
}) {
  return (
    <div class="pk-cluster">
      <span class="pk-small">Share on:</span>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="pk-btn pk-btn--secondary pk-btn--sm"
        aria-label="Share on X / Twitter"
      >
        <IconXTwitter />X
      </a>
      <a
        href={blueskyUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="pk-btn pk-btn--secondary pk-btn--sm"
        aria-label="Share on Bluesky"
      >
        <IconBluesky />
        Bluesky
      </a>
      <a
        href={redditUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="pk-btn pk-btn--secondary pk-btn--sm"
        aria-label="Share on Reddit"
      >
        <IconReddit />
        Reddit
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

function InviteRow({
  row,
  position,
  showRemove,
  onChange,
  onRemove,
  onPasteEmail,
}: {
  row: InviteRowData;
  position: number;
  showRemove: boolean;
  onChange: (id: number, field: keyof Omit<InviteRowData, "id">, value: string) => void;
  onRemove: (id: number) => void;
  onPasteEmail: (id: number, text: string) => void;
}) {
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.getData("text") ?? "";
      if (!pasted.includes("<") && !pasted.includes(",") && !pasted.includes("\n")) return;
      e.preventDefault();
      onPasteEmail(row.id, pasted);
    },
    [row.id, onPasteEmail],
  );

  return (
    <div class="pk-grid pk-grid--tight">
      <TextInput
        placeholder="First (opt.)"
        value={row.firstName}
        onInput={(e) => onChange(row.id, "firstName", (e.target as HTMLInputElement).value)}
        aria-label={`Invite ${position} first name (optional)`}
        autocomplete="off"
      />
      <TextInput
        placeholder="Last (opt.)"
        value={row.lastName}
        onInput={(e) => onChange(row.id, "lastName", (e.target as HTMLInputElement).value)}
        aria-label={`Invite ${position} last name (optional)`}
        autocomplete="off"
      />
      <TextInput
        type="email"
        placeholder="colleague@example.com"
        value={row.email}
        onInput={(e) => onChange(row.id, "email", (e.target as HTMLInputElement).value)}
        onPaste={handlePaste}
        aria-label={`Invite ${position} email address`}
        autocomplete="off"
      />
      {/* Named per row: "Remove row" repeated ten times gives a reader no way
          to tell which one they are about to delete. */}
      <div class="pk-cluster pk-cluster--end">
        {showRemove && (
          <Button
            size="sm"
            variant="danger-quiet"
            icon
            aria-label={`Remove invite ${position}`}
            onClick={() => onRemove(row.id)}
          >
            <span aria-hidden="true">×</span>
          </Button>
        )}
      </div>
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
  const [status, setStatus] = useState<{ message: string; tone: "ok" | "danger" } | null>(null);
  const [sending, setSending] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);
  // Generated rather than fixed: two share panels can share a page, and a
  // duplicated id would point both toggles at the same set of fields.
  const fieldsId = useId();

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
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
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
      updated[idx] = {
        ...updated[idx],
        email: entries[0].email,
        firstName: entries[0].firstName ?? "",
        lastName: entries[0].lastName ?? "",
      };
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
            updated[i] = {
              ...updated[i],
              email: entries[entryIdx].email,
              firstName: entries[entryIdx].firstName ?? "",
              lastName: entries[entryIdx].lastName ?? "",
            };
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
      .map((r) => ({
        email: r.email.trim(),
        firstName: r.firstName.trim() || undefined,
        lastName: r.lastName.trim() || undefined,
      }))
      .filter((i) => i.email);

    if (!invites.length) {
      setStatus({ message: "Please enter at least one email address.", tone: "danger" });
      return;
    }
    const badEmail = invites.find((i) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email));
    if (badEmail) {
      setStatus({ message: `"${badEmail.email}" doesn't look like a valid email address.`, tone: "danger" });
      return;
    }

    setSending(true);
    setStatus(null);

    try {
      const payload = registrationInviteCreateSchema.parse({ invites });
      const data = await postJson(`/api/v1/events/${eventSlug}/invites`, payload, peerInviteResultSchema, {
        authorization: `Bearer ${manageToken}`,
      });
      const count = data.created.length;
      setStatus({
        message: `Sent ${count} invitation${count !== 1 ? "s" : ""}. They'll receive a registration link shortly.`,
        tone: "ok",
      });
      setRows([makeRow()]);
    } catch (error) {
      setStatus({
        message: error instanceof ApiClientError ? error.message : "Could not send invites. Please try again later.",
        tone: "danger",
      });
    } finally {
      setSending(false);
    }
  }, [rows, eventSlug, manageToken]);

  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-cluster">
        <Button onClick={toggleExpanded} aria-expanded={expanded} aria-controls={fieldsId}>
          <span aria-hidden="true">✉️</span> Invite by email
        </Button>
      </div>

      <div id={fieldsId} class="pk-stack pk-stack--snug" hidden={!expanded} ref={fieldsRef}>
        <p class="pk-small">
          We'll send a personal invitation on your behalf — they'll receive a direct registration link. Paste a list
          below or fill in rows one by one.
        </p>
        <Field
          label="Paste email addresses to add"
          help={'Names are inferred from dotted addresses or the "Name <email>" format.'}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              placeholder={"alice@example.net\nBob Smith <bob@example.com>\ncarol.jones@co.example…"}
              onPaste={handlePasteArea}
            />
          )}
        </Field>
        <div class="pk-stack pk-stack--snug">
          {rows.map((row, index) => (
            <InviteRow
              key={row.id}
              row={row}
              position={index + 1}
              showRemove={showRemove}
              onChange={updateRow}
              onRemove={removeRow}
              onPasteEmail={handlePasteEmail}
            />
          ))}
        </div>
        <div class="pk-cluster">
          {rows.length < MAX_INVITES && (
            <Button size="sm" onClick={() => addRow()}>
              Add row
            </Button>
          )}
          <Button size="sm" variant="primary" loading={sending} onClick={() => void handleSend()}>
            {sending ? "Sending…" : "Send invites"}
          </Button>
        </div>
        {status && <Alert tone={status.tone}>{status.message}</Alert>}
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
  const twitterUrl = `https://twitter.com/intent/tweet?text=${twitterText}`;
  const blueskyUrl = `https://bsky.app/intent/compose?text=${blueskyText}`;
  const redditUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${redditTitle}`;
  const ogBadgeUrl = extractOgBadgeUrl(shareUrl);
  const badgeFilename = `attendee-badge-${nameSlug(options.firstName, options.lastName)}.png`;

  const canInvite = Boolean(manageToken && eventSlug);

  return (
    <Panel class="pk pk-start">
      <PanelBody class="pk-stack pk-stack--snug">
        {ogBadgeUrl && <OgBadge ogBadgeUrl={ogBadgeUrl} eventName={eventName} badgeFilename={badgeFilename} />}

        <h3>Invite a colleague — seats are limited</h3>
        <p class="pk-small">
          In-person spots fill fast. Every registration through your personal link helps us prioritize attendees and
          shape the program.
        </p>

        <div class="pk-cluster">
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="pk-btn pk-btn--primary"
            aria-label="Share on LinkedIn"
          >
            <IconLinkedIn />
            Share on LinkedIn
          </a>
        </div>

        {canInvite && <InvitePanel manageToken={manageToken as string} eventSlug={eventSlug as string} />}

        <CopyLinkRow shareUrl={shareUrl} />
        <SocialLinks twitterUrl={twitterUrl} blueskyUrl={blueskyUrl} redditUrl={redditUrl} />
      </PanelBody>
    </Panel>
  );
}

export function renderSharePanel(container: HTMLElement, options: SharePanelOptions): void {
  render(<SharePanelInner options={options} />, container);
}

/**
 * Busts the R2 cache on the OG badge image inside a share panel and shows the
 * loading indicator until the freshly-rendered PNG arrives.
 */
export function refreshSharePanelBadge(panelContainer: HTMLElement): void {
  const img = panelContainer.querySelector<HTMLImageElement>("[data-og-badge-img]");
  const loader = panelContainer.querySelector<HTMLElement>("[data-og-badge-loading]");
  if (!img) return;

  const baseUrl = img.src.split("?")[0];
  if (loader) loader.hidden = false;

  const hideLoader = (): void => {
    if (loader) loader.hidden = true;
  };
  img.addEventListener("load", hideLoader, { once: true });
  img.addEventListener("error", hideLoader, { once: true });
  img.src = `${baseUrl}?t=${Date.now()}`;
}
