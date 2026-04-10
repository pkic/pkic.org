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
import { asyncPaymentWindow } from "../../shared/constants/async-payment-window";

interface DonationSession {
  grossAmount: number;
  currency: string;
  donorFirstName: string | null;
  source: string | null;
  completedAt: string | null;
}

interface PendingSession {
  pending: true;
  asyncPayment?: boolean;
  paymentMethodType?: string | null;
  sessionExpiresAt?: number | null;
}

interface TerminalSession {
  failed?: true;
  expired?: true;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15; // 30 s — fast phase for card / wallet payments

// Async payment methods (bank transfer / ACH / SEPA) can settle anywhere from
// minutes to several business days.  We keep watching for the duration of the
// browser session so the badge appears immediately if the bank confirms quickly,
// while gracefully stopping after a reasonable limit and letting the email take
// over for slower transfers.
const ASYNC_POLL_INTERVAL_MS = 5000;
const ASYNC_MAX_POLLS = 60; // 5 min — covers same-day SEPA / fast ACH

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

  // ── Phase 1: fast polling (card / wallet — typically confirms in < 5 s) ───
  let session: DonationSession | null = null;
  let isAsyncPayment = false;
  let asyncMethodType: string | null | undefined;
  let asyncExpiresAt: number | null | undefined;
  for (let i = 0; i < MAX_POLLS; i++) {
    try {
      const data = await getJson<DonationSession | PendingSession | TerminalSession>(
        `/api/v1/donations/session?session_id=${encodeURIComponent(sessionId)}`,
      );
      if ("asyncPayment" in data && data.asyncPayment) {
        isAsyncPayment = true;
        asyncMethodType = data.paymentMethodType;
        asyncExpiresAt  = data.sessionExpiresAt;
        break; // switch to slow async phase below
      }
      if ("failed" in data) { renderFailed(container); return; }
      if ("expired" in data) { renderExpired(container); return; }
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

  // Fast phase resolved — show badge and exit if already confirmed.
  if (session) {
    renderBadge(container, session, sessionId);
    void fetchPromoterCode(sessionId).then((result) => {
      if (!result) return;
      updateShareLinks(container, result.shareUrl, session!, formattedAmountFor(session!));
    });
    return;
  }

  // Unknown session (not found at all after timeout) — generic fallback.
  if (!isAsyncPayment) {
    renderStaticThankYou(container);
    return;
  }

  // ── Phase 2: async payment phase (bank transfer / ACH / SEPA) ────────────
  // Show the informational message immediately so the user is not left with a
  // spinner.  Keep polling at a slower cadence — many bank transfers settle
  // the same day and we want to show the badge automatically if they do.
  // Cap the poll count to the remaining time until session expiry so we don't
  // keep polling forever on a long-window (e.g. 30-day) session.
  renderAsyncPending(container, asyncMethodType, asyncExpiresAt);

  const msUntilExpiry = asyncExpiresAt ? Math.max(0, asyncExpiresAt * 1000 - Date.now()) : null;
  const asyncPolls = msUntilExpiry !== null
    ? Math.min(ASYNC_MAX_POLLS, Math.ceil(msUntilExpiry / ASYNC_POLL_INTERVAL_MS))
    : ASYNC_MAX_POLLS;

  for (let i = 0; i < asyncPolls; i++) {
    await sleep(ASYNC_POLL_INTERVAL_MS);
    try {
      const data = await getJson<DonationSession | PendingSession | TerminalSession>(
        `/api/v1/donations/session?session_id=${encodeURIComponent(sessionId)}`,
      );
      if ("failed" in data) { renderFailed(container); return; }
      if ("expired" in data) { renderExpired(container); return; }
      if (!("pending" in data)) {
        session = data;
        break;
      }
    } catch {
      // Tolerate network errors; keep trying
    }
  }

  if (!session) {
    // Still awaiting after the in-session window — leave the async message.
    // The donor will receive an email when Stripe confirms.
    return;
  }

  renderBadge(container, session, sessionId);
  // Obtain (or create) the personalized share link in the background; update
  // the share buttons once the code is resolved.
  void fetchPromoterCode(sessionId).then((result) => {
    if (!result) return;
    updateShareLinks(container, result.shareUrl, session, formattedAmountFor(session));
  });
}

interface PromoterResult {
  code: string;
  shareUrl: string;
  ogImageUrl: string;
}

async function fetchPromoterCode(sessionId: string): Promise<PromoterResult | null> {
  try {
    const res = await fetch("/api/v1/donations/promoter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as PromoterResult;
  } catch {
    return null;
  }
}

function formattedAmountFor(session: DonationSession): string {
  const info = currencyInfo(session.currency);
  const majorAmount = toMajorUnit(session.grossAmount, session.currency);
  return formatCurrency(majorAmount, info.code.toUpperCase(), info.zeroDecimal ?? false);
}

/** Swap the generic donate URL in the share buttons for the personalized /donate/r/:code URL. */
function updateShareLinks(container: HTMLElement, shareUrl: string, session: DonationSession, formattedAmount: string): void {
  const shareText = `I just made a voluntary donation of ${formattedAmount} to the PKI Consortium to keep our memberships, resources, and events free! 🎉`;
  const twitterHref   = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`;
  const linkedinHref  = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: shareUrl })}`;

  const twitterBtn = container.querySelector<HTMLAnchorElement>("[data-share-twitter]");
  const linkedinBtn = container.querySelector<HTMLAnchorElement>("[data-share-linkedin]");
  const linkInput  = container.querySelector<HTMLInputElement>("[data-share-link]");
  const copyBtn    = container.querySelector<HTMLButtonElement>("[data-share-copy]");

  if (twitterBtn)  twitterBtn.href  = twitterHref;
  if (linkedinBtn) linkedinBtn.href = linkedinHref;

  if (linkInput) {
    linkInput.value = shareUrl;
    linkInput.hidden = false;
    linkInput.closest<HTMLElement>("[data-share-link-row]")?.removeAttribute("hidden");
  }
  if (copyBtn) {
    copyBtn.hidden = false;
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard?.writeText(shareUrl).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = orig; }, 2000);
      });
    });
  }
}

function renderBadge(container: HTMLElement, session: DonationSession, sessionId: string): void {
  const info = currencyInfo(session.currency);
  const majorAmount = toMajorUnit(session.grossAmount, session.currency);
  const formattedAmount = formatCurrency(majorAmount, info.code.toUpperCase(), info.zeroDecimal ?? false);
  const greeting = session.donorFirstName ? `${session.donorFirstName}, thank` : "Thank";

  // Initial share URL is the generic donate page; it gets swapped for the
  // personalized /donate/r/:code URL once fetchPromoterCode resolves.
  const shareUrl = "https://pkic.org/donate/";
  const shareText = `I just made a voluntary donation of ${formattedAmount} to the PKI Consortium to keep our memberships, resources, and events free! 🎉`;

  const twitterHref = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: shareUrl })}`;

  const badgeUrl      = `/api/v1/og/donation/${encodeURIComponent(sessionId)}`;
  const badgeFilename = `donation-badge${session.donorFirstName ? "-" + session.donorFirstName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}.jpg`;

  container.innerHTML = `
    <div class="donation-badge">
      <div class="donation-badge-amount">${formattedAmount}</div>
      <h2 class="donation-badge-title">${greeting} you for your donation!</h2>
      <p class="donation-badge-body">
        Your generous contribution helps the PKI Consortium keep its memberships, resources, and events free,
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
          data-share-twitter
          target="_blank"
          rel="noopener"
          aria-label="Share on X / Twitter"
        >𝕏 Share</a>
        <a
          href="${escapeAttr(linkedinHref)}"
          class="btn btn-outline-secondary donation-badge-share-btn"
          data-share-linkedin
          target="_blank"
          rel="noopener"
          aria-label="Share on LinkedIn"
        >in Share</a>
      </div>
      <div class="donation-badge-share-link-row" data-share-link-row hidden>
        <p class="donation-badge-share-label mb-1">Your personal share link:</p>
        <div class="d-flex gap-2 align-items-center">
          <input
            type="text"
            class="form-control form-control-sm"
            data-share-link
            value="${escapeAttr(shareUrl)}"
            readonly
            aria-label="Your personalised donation share link"
          />
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary flex-shrink-0"
            data-share-copy
            aria-label="Copy link"
          >Copy</button>
        </div>
        <p class="text-muted small mt-1">Sharing this link lets us track who is driving donations — even without donating yourself.</p>
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

function renderAsyncPending(container: HTMLElement, methodType?: string | null, expiresAt?: number | null): void {
  const info = asyncPaymentWindow(methodType ?? null);
  const deadlineHtml = expiresAt
    ? `<p class="donation-badge-body">
        Please ensure your payment is received by
        <strong>${new Date(expiresAt * 1000).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</strong>.
        After this deadline Stripe will close the payment window.
      </p>`
    : "";
  container.innerHTML = `
    <div class="donation-badge donation-badge--pending">
      <h2 class="donation-badge-title">Your payment is being processed</h2>
      <p class="donation-badge-body">
        Your donation has been initiated via <strong>${info.label}</strong>.
        ${expiresAt ? "" : "These payments typically take a few business days to settle."}
      </p>
      ${deadlineHtml}
      <p class="donation-badge-body">
        Once your bank confirms the payment you will receive a receipt and your
        personalised badge by email. No further action is needed on your part.
      </p>
      <p class="donation-badge-body text-muted small">
        Thank you for your patience and generous support of the PKI Consortium!
      </p>
    </div>
  `;
  container.hidden = false;
}

function renderFailed(container: HTMLElement): void {
  container.innerHTML = `
    <div class="donation-badge donation-badge--failed">
      <h2 class="donation-badge-title">Payment not completed</h2>
      <p class="donation-badge-body">
        Your bank was unable to process the payment. No funds have been charged.
      </p>
      <p class="donation-badge-body">
        If you would like to try again, please
        <a href="/donate/">return to the donation page</a> and use a different
        payment method.
      </p>
    </div>
  `;
  container.hidden = false;
}

function renderExpired(container: HTMLElement): void {
  container.innerHTML = `
    <div class="donation-badge donation-badge--expired">
      <h2 class="donation-badge-title">Checkout session expired</h2>
      <p class="donation-badge-body">
        The payment window for this checkout has closed and no payment was taken.
      </p>
      <p class="donation-badge-body">
        Please return to the donation page to 
        <a href="/donate/">try again</a>, we really appreciate your support.
      </p>
    </div>
  `;
  container.hidden = false;
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
