/**
 * Donation thank-you page badge.
 *
 * Reads the Stripe `session_id` from the URL, polls the backend until the
 * webhook has confirmed the payment, then renders an "I just donated X"
 * badge similar to the event-registration share panel.
 */

import { render, type ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { getJson } from "../api-client";
import { currencyInfo, toMajorUnit } from "../../../shared/constants/currencies";
import { asyncPaymentWindow } from "../../../shared/constants/async-payment-window";

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
const MAX_POLLS = 15;
const ASYNC_POLL_INTERVAL_MS = 5000;
const ASYNC_MAX_POLLS = 60;

// ── Preact components ─────────────────────────────────────────────────────

function Loading() {
  return (
    <div class="donation-badge-loading text-center text-muted py-3">
      <div class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
      Confirming your donation…
    </div>
  );
}

function BadgeImage({ badgeUrl, badgeFilename }: { badgeUrl: string; badgeFilename: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    img.addEventListener("load", () => {
      if (loadingRef.current) loadingRef.current.hidden = true;
      img.classList.add("donation-badge-og-img--loaded");
    });
    img.addEventListener("error", () => {
      if (previewRef.current) previewRef.current.hidden = true;
    });
  }, []);

  return (
    <div class="donation-badge-og-preview" ref={previewRef} data-donation-badge-preview>
      <div class="donation-badge-og-loading" ref={loadingRef} data-donation-badge-loading>
        <span class="spinner-border spinner-border-sm text-secondary me-2" role="status" aria-hidden="true" />
        <span class="text-muted small">Generating badge…</span>
      </div>
      <img
        ref={imgRef}
        src={badgeUrl}
        alt="Donation badge for sharing on social media"
        class="donation-badge-og-img"
        data-donation-badge-img
        width={600}
        height={315}
      />
    </div>
  );
}

function DonationBadge({
  session,
  sessionId,
  shareUrl,
  shareText,
}: {
  session: DonationSession;
  sessionId: string;
  shareUrl: string;
  shareText: string;
}) {
  const formattedAmount = formattedAmountFor(session);
  const greeting = session.donorFirstName ? `${session.donorFirstName}, thank` : "Thank";

  const twitterHref = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: shareUrl })}`;

  const badgeUrl = `/api/v1/og/donation/${encodeURIComponent(sessionId)}`;
  const badgeFilename = `donation-badge${session.donorFirstName ? "-" + session.donorFirstName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}.jpg`;

  return (
    <div class="donation-badge">
      <div class="donation-badge-amount">{formattedAmount}</div>
      <h2 class="donation-badge-title">{greeting} you for your donation!</h2>
      <p class="donation-badge-body">
        Your generous contribution helps the PKI Consortium keep its memberships, resources, and events free,
        open, and accessible to more of the global PKI community.
      </p>

      <BadgeImage badgeUrl={badgeUrl} badgeFilename={badgeFilename} />

      <div class="donation-badge-og-actions text-center mt-2 mb-1">
        <a
          href={`${badgeUrl}?download=1&name=${encodeURIComponent(badgeFilename)}`}
          download={badgeFilename}
          class="btn btn-sm btn-outline-secondary"
          aria-label="Download your donation badge"
        >⬇ Download badge</a>
      </div>

      <p class="donation-badge-share-label">Spread the word:</p>
      <div class="donation-badge-share">
        <a
          href={twitterHref}
          class="btn btn-outline-secondary donation-badge-share-btn"
          data-share-twitter
          target="_blank"
          rel="noopener"
          aria-label="Share on X / Twitter"
        >𝕏 Share</a>
        <a
          href={linkedinHref}
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
            value={shareUrl}
            readOnly
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
  );
}

function AsyncPending({
  methodType,
  expiresAt,
}: {
  methodType?: string | null;
  expiresAt?: number | null;
}) {
  const info = asyncPaymentWindow(methodType ?? null);
  const deadline = expiresAt
    ? new Date(expiresAt * 1000).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
    : null;

  return (
    <div class="donation-badge donation-badge--pending">
      <h2 class="donation-badge-title">Your payment is being processed</h2>
      <p class="donation-badge-body">
        Your donation has been initiated via <strong>{info.label}</strong>.
        {!expiresAt && " These payments typically take a few business days to settle."}
      </p>
      {deadline && (
        <p class="donation-badge-body">
          Please ensure your payment is received by <strong>{deadline}</strong>.
          After this deadline Stripe will close the payment window.
        </p>
      )}
      <p class="donation-badge-body">
        Once your bank confirms the payment you will receive a receipt and your
        personalised badge by email. No further action is needed on your part.
      </p>
      <p class="donation-badge-body text-muted small">
        Thank you for your patience and generous support of the PKI Consortium!
      </p>
    </div>
  );
}

function FailedBadge() {
  return (
    <div class="donation-badge donation-badge--failed">
      <h2 class="donation-badge-title">Payment not completed</h2>
      <p class="donation-badge-body">
        Your bank was unable to process the payment. No funds have been charged.
      </p>
      <p class="donation-badge-body">
        If you would like to try again, please{" "}
        <a href="/donate/">return to the donation page</a> and use a different
        payment method.
      </p>
    </div>
  );
}

function ExpiredBadge() {
  return (
    <div class="donation-badge donation-badge--expired">
      <h2 class="donation-badge-title">Checkout session expired</h2>
      <p class="donation-badge-body">
        The payment window for this checkout has closed and no payment was taken.
      </p>
      <p class="donation-badge-body">
        Please return to the donation page to{" "}
        <a href="/donate/">try again</a>, we really appreciate your support.
      </p>
    </div>
  );
}

function GenericThankYou({ pendingHtml }: { pendingHtml: string }) {
  // SAFETY: pendingHtml is read from Hugo-rendered static markup (data-donation-pending-content)
  return (
    <div
      class="donation-badge donation-badge--generic"
      dangerouslySetInnerHTML={{ __html: pendingHtml }}
    />
  );
}

// ── Render helpers ────────────────────────────────────────────────────────

function renderTo(container: HTMLElement, content: ComponentChildren): void {
  render(content as preact.VNode, container);
  container.hidden = false;
}

// ── Main flow ─────────────────────────────────────────────────────────────

export async function initDonationThankYou(): Promise<void> {
  const container = document.querySelector<HTMLElement>("[data-donation-badge]");
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  if (!sessionId || !sessionId.startsWith("cs_")) {
    renderStaticThankYou(container);
    return;
  }

  renderTo(container, <Loading />);

  // ── Phase 1: fast polling (card / wallet) ─────────────────────────────
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
        asyncExpiresAt = data.sessionExpiresAt;
        break;
      }
      if ("failed" in data) { renderTo(container, <FailedBadge />); return; }
      if ("expired" in data) { renderTo(container, <ExpiredBadge />); return; }
      if (!("pending" in data)) {
        session = data as DonationSession;
        break;
      }
    } catch {
      // Tolerate network errors during polling
    }
    if (i < MAX_POLLS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  if (session) {
    renderBadge(container, session, sessionId);
    void fetchPromoterCode(sessionId).then((result) => {
      if (!result) return;
      updateShareLinks(container, result.shareUrl, session!, formattedAmountFor(session!));
    });
    return;
  }

  if (!isAsyncPayment) {
    renderStaticThankYou(container);
    return;
  }

  // ── Phase 2: async payment (bank transfer / ACH / SEPA) ───────────────
  renderTo(container, <AsyncPending methodType={asyncMethodType} expiresAt={asyncExpiresAt} />);

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
      if ("failed" in data) { renderTo(container, <FailedBadge />); return; }
      if ("expired" in data) { renderTo(container, <ExpiredBadge />); return; }
      if (!("pending" in data)) {
        session = data as DonationSession;
        break;
      }
    } catch {
      // Tolerate network errors
    }
  }

  if (!session) return;

  renderBadge(container, session, sessionId);
  void fetchPromoterCode(sessionId).then((result) => {
    if (!result) return;
    updateShareLinks(container, result.shareUrl, session, formattedAmountFor(session));
  });
}

// ── Badge rendering ─────────────────────────────────────────────────────

function renderBadge(container: HTMLElement, session: DonationSession, sessionId: string): void {
  const formattedAmount = formattedAmountFor(session);
  const shareUrl = "https://pkic.org/donate/";
  const shareText = `I just made a voluntary donation of ${formattedAmount} to the PKI Consortium to keep our memberships, resources, and events free! 🎉`;

  renderTo(container, (
    <DonationBadge session={session} sessionId={sessionId} shareUrl={shareUrl} shareText={shareText} />
  ));
}

function renderStaticThankYou(container: HTMLElement): void {
  const pendingEl = document.querySelector<HTMLElement>("[data-donation-pending-content]");
  const inner = pendingEl?.innerHTML?.trim() ?? "";
  renderTo(container, <GenericThankYou pendingHtml={inner} />);
}

// ── Share link updates ──────────────────────────────────────────────────

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

/** Swap the generic donate URL for the personalized /donate/r/:code URL. */
function updateShareLinks(container: HTMLElement, shareUrl: string, session: DonationSession, formattedAmount: string): void {
  const shareText = `I just made a voluntary donation of ${formattedAmount} to the PKI Consortium to keep our memberships, resources, and events free! 🎉`;
  const twitterHref = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: shareUrl })}`;

  const twitterBtn = container.querySelector<HTMLAnchorElement>("[data-share-twitter]");
  const linkedinBtn = container.querySelector<HTMLAnchorElement>("[data-share-linkedin]");
  const linkInput = container.querySelector<HTMLInputElement>("[data-share-link]");
  const copyBtn = container.querySelector<HTMLButtonElement>("[data-share-copy]");

  if (twitterBtn) twitterBtn.href = twitterHref;
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

// ── Utilities ───────────────────────────────────────────────────────────

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Auto-init
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initDonationThankYou());
} else {
  void initDonationThankYou();
}
