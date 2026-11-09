import { DownloadAction } from "../../ui/DownloadAction";
import { downloadFile } from "../download-file";
import { getBlob } from "../api-client";
import { personalPromotionImagePath } from "../../../shared/personal-promotion-image";
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
import { render, type ComponentChildren } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { IconLinkedIn, IconXTwitter, IconBluesky, IconReddit } from "../../components/icons";
import { RegistrationInviteForm } from "../../components/event-invites/RegistrationInviteForm";
import { Alert } from "../../ui/Alert";
import { CopyLinkRow } from "./copy-link-row";
import { ButtonLink } from "../../ui/Button";
import { Panel, PanelBody } from "../../ui/Panel";
import { Spinner } from "../../ui/Spinner";
// `pk-mono` and `pk-framed` are written as class names here rather than
// reached through a component, so this module has to pull their stylesheet
// into its own chunk.
import "../../ui/Content.css";

export interface SharePanelOptions {
  shareUrl: string;
  badgeVersion?: string;
  eventName: string;
  firstName?: string | null;
  lastName?: string | null;
  manageToken?: string | null;
  eventSlug?: string | null;
  /**
   * The viewer is themself waiting for an in-person seat. Telling them seats
   * are limited and spots fill fast is their own situation read back to them
   * as a sales line, so the invitation drops the urgency.
   */
  waitlisted?: boolean;
  /** Leave out the badge where the page already shows it with the other materials. */
  hideBadge?: boolean;
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

export function extractOgBadgeUrl(shareUrl: string, version?: string): string | null {
  try {
    const match = shareUrl.match(/\/r\/([A-Za-z0-9]+)(?:[?#]|$)/);
    if (!match) return null;
    const origin = new URL(shareUrl).origin;
    return `${origin}${personalPromotionImagePath(match[1], version)}`;
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
  const squareUrl = new URL(ogBadgeUrl);
  squareUrl.searchParams.set("format", "square");
  squareUrl.searchParams.set("download", "1");
  const squareFilename = badgeFilename.replace(/\.png$/u, "-square.png");
  squareUrl.searchParams.set("name", squareFilename);
  const [error, setError] = useState("");
  async function download(url: string, filename: string) {
    setError("");
    try {
      const blob = await getBlob(url);
      downloadFile(blob, blob.type, filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download your badge. Try again.");
    }
  }
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
        <DownloadAction
          label="Download badge (PNG)"
          menuLabel="Download badge formats"
          options={[
            { id: "landscape", label: "Landscape badge (PNG)", onDownload: () => download(ogBadgeUrl, badgeFilename) },
            { id: "square", label: "Square badge (PNG)", onDownload: () => download(squareUrl.href, squareFilename) },
          ]}
        />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
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
      <ButtonLink href={twitterUrl} external aria-label="Share on X / Twitter">
        <IconXTwitter />X
      </ButtonLink>
      <ButtonLink href={blueskyUrl} external aria-label="Share on Bluesky">
        <IconBluesky />
        Bluesky
      </ButtonLink>
      <ButtonLink href={redditUrl} external aria-label="Share on Reddit">
        <IconReddit />
        Reddit
      </ButtonLink>
    </div>
  );
}

// ── Main share panel ────────────────────────────────────────────────────────

export function SharePanel({
  options,
  inviteAction,
}: {
  options: SharePanelOptions;
  inviteAction?: ComponentChildren;
}) {
  const { shareUrl, eventName, manageToken, eventSlug } = options;

  const shareText = `I just registered for ${eventName} — join me!`;
  const twitterText = encodeURIComponent(`${shareText} ${shareUrl}`);
  const blueskyText = encodeURIComponent(`${shareText}\n${shareUrl}`);
  const redditTitle = encodeURIComponent(`Join me at ${eventName}`);

  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${twitterText}`;
  const blueskyUrl = `https://bsky.app/intent/compose?text=${blueskyText}`;
  const redditUrl = `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${redditTitle}`;
  const ogBadgeUrl = extractOgBadgeUrl(shareUrl, options.badgeVersion);
  const badgeFilename = `attendee-badge-${nameSlug(options.firstName, options.lastName)}.png`;

  const canInvite = Boolean(manageToken && eventSlug);

  return (
    <Panel class="pk pk-start">
      <PanelBody class="pk-stack pk-stack--snug">
        {ogBadgeUrl && !options.hideBadge && (
          <OgBadge ogBadgeUrl={ogBadgeUrl} eventName={eventName} badgeFilename={badgeFilename} />
        )}

        <h3>Share this event</h3>
        <p class="pk-small">
          {canInvite || inviteAction
            ? "Invite colleagues by email or share your personal link."
            : "Share your personal link with colleagues."}
        </p>

        <div class="pk-cluster">
          {inviteAction}
          <ButtonLink href={linkedinUrl} external variant="primary" aria-label="Share on LinkedIn">
            <IconLinkedIn />
            Share on LinkedIn
          </ButtonLink>
        </div>

        {canInvite && manageToken && eventSlug && (
          <RegistrationInviteForm manageToken={manageToken} eventSlug={eventSlug} />
        )}

        <CopyLinkRow
          url={shareUrl}
          label="Your unique sharing link"
          help="Registrations made through this link are credited to you."
        />
        <SocialLinks twitterUrl={twitterUrl} blueskyUrl={blueskyUrl} redditUrl={redditUrl} />
      </PanelBody>
    </Panel>
  );
}

export function renderSharePanel(container: HTMLElement, options: SharePanelOptions): void {
  render(<SharePanel options={options} />, container);
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
