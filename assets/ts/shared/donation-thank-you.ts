/**
 * Donation thank-you page badge.
 *
 * Reads the Stripe `session_id` from the URL, polls the backend until the
 * webhook has confirmed the payment, then renders an "I just donated X"
 * badge similar to the event-registration share panel.
 *
 * The badge includes:
 *   - The donated amount in the donor's currency
 *   - Social share text and links
 *   - A disclaimer reiterating the non-profit/non-transactional nature
 *
 * If the session_id is missing or the payment is never confirmed (timeout),
 * the page degrades to a generic thank-you message.
 */

import { getJson } from "./api-client";
import { currencyInfo, toMajorUnit } from "../../shared/constants/currencies";

interface DonationSession {
  grossAmount: number;
  currency: string;
  donorFirstName: string | null;
  source: string | null;
  completedAt: string | null;
}

interface PendingSession {
  pending: true;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15; // 30s total

export async function initDonationThankYou(): Promise<void> {
  const container = document.querySelector<HTMLElement>("[data-donation-badge]");
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  if (!sessionId || !sessionId.startsWith("cs_")) {
    // No valid session — show a neutral holding message rather than claiming success
    renderStaticThankYou(container);
    return;
  }

  // Show loading state while we wait for the webhook to confirm
  container.innerHTML = `
    <div class="donation-badge-loading text-center text-muted py-3">
      <div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
      Confirming your donation…
    </div>
  `;
  container.hidden = false;

  // Poll the session endpoint until the webhook fires (or we time out)
  let session: DonationSession | null = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    try {
      const data = await getJson<DonationSession | PendingSession>(
        `/api/v1/donations/session?session_id=${encodeURIComponent(sessionId)}`,
      );
      if (!("pending" in data)) {
        session = data;
        break;
      }
    } catch {
      // Tolerate network errors during polling
    }
    if (i < MAX_POLLS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  if (!session) {
    renderStaticThankYou(container);
    return;
  }

  renderBadge(container, session, sessionId);
}

function renderBadge(container: HTMLElement, session: DonationSession, sessionId: string): void {
  const info = currencyInfo(session.currency);
  const majorAmount = toMajorUnit(session.grossAmount, session.currency);
  const formattedAmount = formatCurrency(majorAmount, info.code.toUpperCase(), info.zeroDecimal);
  const greeting = session.donorFirstName ? `${session.donorFirstName}, thank` : "Thank";

  const shareText = `I just made a voluntary donation of ${formattedAmount} to the PKI Consortium to support free and open PKI events! 🎉`;
  const shareUrl = "https://pkic.org/donate/";

  const twitterHref = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: shareUrl })}`;

  const badgeUrl      = `/api/v1/og/donation/${encodeURIComponent(sessionId)}`;
  const badgeFilename = `donation-badge${session.donorFirstName ? "-" + session.donorFirstName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}.jpg`;

  container.innerHTML = `
    <div class="donation-badge">
      <div class="donation-badge-amount">${formattedAmount}</div>
      <h2 class="donation-badge-title">${greeting} you for your donation!</h2>
      <p class="donation-badge-body">
        Your generous contribution helps the PKI Consortium keep its events free,
        open, and accessible to more of the global PKI community.
      </p>
      <div class="donation-badge-og-preview" data-donation-badge-preview>
        <div class="donation-badge-og-loading" data-donation-badge-loading>
          <span class="spinner-border spinner-border-sm text-secondary me-2" role="status" aria-hidden="true"></span>
          <span class="text-muted small">Generating badge…</span>
        </div>
        <img
          src="${escapeAttr(badgeUrl)}"
          alt="Donation badge for sharing on social media"
          class="donation-badge-og-img"
          data-donation-badge-img
          width="600"
          height="315"
        />
      </div>
      <div class="donation-badge-og-actions text-center mt-2 mb-1">
        <a
          href="${escapeAttr(badgeUrl)}?download=1&amp;name=${encodeURIComponent(badgeFilename)}"
          download="${escapeAttr(badgeFilename)}"
          class="btn btn-sm btn-outline-secondary"
          aria-label="Download your donation badge"
        >⬇ Download badge</a>
      </div>
      <p class="donation-badge-share-label">Spread the word:</p>
      <div class="donation-badge-share">
        <a
          href="${escapeAttr(twitterHref)}"
          class="btn btn-outline-secondary donation-badge-share-btn"
          target="_blank"
          rel="noopener"
          aria-label="Share on X / Twitter"
        >𝕏 Share</a>
        <a
          href="${escapeAttr(linkedinHref)}"
          class="btn btn-outline-secondary donation-badge-share-btn"
          target="_blank"
          rel="noopener"
          aria-label="Share on LinkedIn"
        >in Share</a>
      </div>
      <p class="donation-badge-disclaimer">
        PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts 
        to PKI Consortium are not deductible as charitable contributions for federal income tax 
        purposes in the United States. This payment is voluntary and is not a ticket, fee, or 
        payment for goods or services. Please consult your tax advisor regarding any possible 
        business-expense treatment or other tax consequences.
      </p>
    </div>
  `;
  container.hidden = false;

  // Hide the loading overlay once the badge image loads; on error hide the whole preview block.
  const img     = container.querySelector<HTMLImageElement>("[data-donation-badge-img]");
  const loading = container.querySelector<HTMLElement>("[data-donation-badge-loading]");
  const preview = container.querySelector<HTMLElement>("[data-donation-badge-preview]");
  if (img && loading) {
    img.addEventListener("load",  () => { loading.style.display = "none"; img.style.opacity = "1"; });
    img.addEventListener("error", () => { if (preview) preview.style.display = "none"; });
    img.style.opacity = "0";
    img.style.transition = "opacity .3s";
  }
}

function renderStaticThankYou(container: HTMLElement): void {
  // Read content authored in the markdown file via the shortcode's .Inner block.
  const pendingEl = document.querySelector<HTMLElement>("[data-donation-pending-content]");
  const inner = pendingEl?.innerHTML?.trim() ?? "";
  container.innerHTML = `<div class="donation-badge donation-badge--generic">${inner}</div>`;
  container.hidden = false;
}

function formatCurrency(amount: number, currencyCode: string, zeroDecimal: boolean): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currencyCode}`;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Auto-init
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initDonationThankYou());
} else {
  void initDonationThankYou();
}
