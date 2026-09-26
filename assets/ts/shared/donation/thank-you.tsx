/**
 * Donation thank-you page badge.
 *
 * Reads the Stripe `session_id` from the URL, polls the backend until the
 * webhook has confirmed the payment, then renders an "I just donated X"
 * badge similar to the event-registration share panel.
 *
 * Design system notes (phase 5):
 *
 *  - The `.donation-badge*` rules in `assets/scss/_donations.scss` were the
 *    surface's whole appearance and were built from Bootstrap's own custom
 *    properties, so the frame, the ground and the type now come from `Panel`
 *    and the tokens instead. The `.donation-badge-og-*` classes had no
 *    stylesheet at all — they were named, toggled, and never defined — so
 *    they are gone rather than translated.
 *  - The personal share link used to be grafted onto rendered DOM by
 *    `updateShareLinks`, which relabelled the copy button to "Copied!" — that
 *    changes a control's accessible name under the reader's cursor. The badge
 *    is now re-rendered with the promoter URL as a prop, and the copy outcome
 *    is a `role="status"` line beside a button whose name never moves.
 *  - The three terminal outcomes are `Alert`s. Each carries its meaning in
 *    words as well as a tone, and `Alert` gives them the role that makes the
 *    outcome announced rather than silently swapped in.
 */

import { render, type ComponentChildren } from "preact";
import type { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getJson, postJson } from "../api-client";
import { formatDateTime } from "../ui";
import { currencyInfo, toMajorUnit } from "../../../shared/constants/currencies";
import { asyncPaymentWindow } from "../../../shared/constants/async-payment-window";
import { classifyDonationPollResult, type DonationSession, type DonationSessionResponse } from "./session-poll";
import {
  donationSessionPollResponseSchema,
  donationPromoterResponseSchema,
  donationPromoterRequestSchema,
} from "../../../shared/schemas/donation";
import { IconLinkedIn, IconXTwitter } from "../../components/icons";
import { Alert } from "../../ui/Alert";
import { Button, ButtonLink } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { Spinner } from "../../ui/Spinner";
import { StatCard } from "../../ui/StatCard";
import { TextInput } from "../../ui/TextControl";
// `pk-framed` and `pk-mono` are written as class names here rather than
// reached through a component, so this module has to pull their stylesheet
// into its own chunk.
import "../../ui/Content.css";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;
const ASYNC_POLL_INTERVAL_MS = 5000;
const ASYNC_MAX_POLLS = 60;

/** Where a donor is sent before a personal promoter link has been issued. */
const GENERIC_SHARE_URL = "https://pkic.org/donate/";

// ── Preact components ─────────────────────────────────────────────────────

function Loading() {
  return (
    <div class="pk pk-cluster pk-cluster--center">
      <Spinner size="sm" label="Confirming your donation…" />
    </div>
  );
}

function BadgeImage({ badgeUrl }: { badgeUrl: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      setState(img.naturalWidth > 0 ? "ready" : "failed");
      return;
    }
    const ready = () => setState("ready");
    const failed = () => setState("failed");
    img.addEventListener("load", ready, { once: true });
    img.addEventListener("error", failed, { once: true });
    return () => {
      img.removeEventListener("load", ready);
      img.removeEventListener("error", failed);
    };
  }, []);

  return (
    <div class="pk-stack pk-stack--tight" data-donation-badge-preview hidden={state === "failed"}>
      {/* The indicator sits above the picture rather than over it: an overlay
          would need an absolutely positioned box, and the system has no
          utility for one. Spinner carries its own role="status", so the wait
          is announced instead of being a silent grey rectangle. */}
      <div class="pk-cluster pk-cluster--center" data-donation-badge-loading hidden={state !== "loading"}>
        <Spinner size="sm" label="Generating badge…" />
      </div>
      <img
        ref={imgRef}
        src={badgeUrl}
        alt="Donation badge for sharing on social media"
        class="pk-framed"
        data-donation-badge-img
        width={600}
        height={315}
      />
    </div>
  );
}

/**
 * The personal promoter link, with a copy control whose outcome is reported
 * separately from the control's own name.
 */
function ShareLinkRow({ shareUrl }: { shareUrl: string }) {
  const [copyStatus, setCopyStatus] = useState("");

  const handleCopy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setCopyStatus("Could not copy automatically — select the link above and copy it.");
      return;
    }
    void clipboard.writeText(shareUrl).then(
      () => setCopyStatus("Link copied to your clipboard."),
      () => setCopyStatus("Could not copy automatically — select the link above and copy it."),
    );
  }, [shareUrl]);

  return (
    <div class="pk-stack pk-stack--snug pk-start" data-share-link-row>
      <Field
        label="Your personal share link"
        help="Sharing this link lets us see who is driving donations — even without donating again yourself."
      >
        {(control) => <TextInput {...control} class="pk-mono" data-share-link value={shareUrl} readOnly />}
      </Field>
      <div class="pk-cluster">
        <Button size="sm" data-share-copy onClick={handleCopy}>
          Copy link
        </Button>
        <p class="pk-small" role="status">
          {copyStatus}
        </p>
      </div>
    </div>
  );
}

function DonationBadge({
  session,
  sessionId,
  shareUrl,
  personalized,
}: {
  session: DonationSession;
  sessionId: string;
  shareUrl: string;
  /** True once `shareUrl` is this donor's own promoter link. */
  personalized: boolean;
}) {
  const formattedAmount = formattedAmountFor(session);
  const greeting = session.donorFirstName ? `${session.donorFirstName}, thank` : "Thank";
  const shareText = shareTextFor(formattedAmount);

  const twitterHref = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url: shareUrl })}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url: shareUrl })}`;

  const badgeUrl = `/api/v1/donations/checkouts/${encodeURIComponent(sessionId)}/badge`;
  const badgeFilename = `donation-badge${session.donorFirstName ? "-" + session.donorFirstName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}.jpg`;

  return (
    <Panel class="pk pk-center">
      <PanelBody class="pk-stack">
        <StatCard label="Your donation" value={formattedAmount} />
        <h2>{greeting} you for your donation!</h2>
        <p class="pk-muted">
          Your generous contribution helps the PKI Consortium keep its memberships, resources, and events free, open,
          and accessible to more of the global PKI community.
        </p>

        <BadgeImage badgeUrl={badgeUrl} />

        <div class="pk-cluster pk-cluster--center">
          <ButtonLink
            href={`${badgeUrl}?download=1&name=${encodeURIComponent(badgeFilename)}`}
            download={badgeFilename}
            size="sm"
          >
            <span aria-hidden="true">⬇</span> Download badge
          </ButtonLink>
        </div>

        <div class="pk-cluster pk-cluster--center">
          <span class="pk-small">Spread the word:</span>
          <ButtonLink
            href={twitterHref}
            data-share-twitter
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Share on X / Twitter"
          >
            <IconXTwitter />X
          </ButtonLink>
          <ButtonLink
            href={linkedinHref}
            data-share-linkedin
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Share on LinkedIn"
          >
            <IconLinkedIn />
            LinkedIn
          </ButtonLink>
        </div>

        {personalized && <ShareLinkRow shareUrl={shareUrl} />}

        <p class="pk-small">
          PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to PKI Consortium are
          not deductible as charitable contributions for federal income tax purposes in the United States. This payment
          is voluntary and is not a ticket, fee, or payment for goods or services. Please consult your tax advisor
          regarding any possible business-expense treatment or other tax consequences.
        </p>
      </PanelBody>
    </Panel>
  );
}

function AsyncPending({ methodType, expiresAt }: { methodType?: string | null; expiresAt?: number | null }) {
  const info = asyncPaymentWindow(methodType ?? null);
  const deadline = expiresAt ? formatDateTime(new Date(expiresAt * 1000).toISOString()) : null;

  return (
    <div class="pk">
      <Alert tone="info" title="Your payment is being processed">
        <div class="pk-stack pk-stack--snug">
          <p>
            Your donation has been initiated via <strong>{info.label}</strong>.
            {!expiresAt && " These payments typically take a few business days to settle."}
          </p>
          {deadline && (
            <p>
              Please ensure your payment is received by <strong>{deadline}</strong>. After this deadline Stripe will
              close the payment window.
            </p>
          )}
          <p>
            Once your bank confirms the payment you will receive a receipt and your personalized badge by email. No
            further action is needed on your part.
          </p>
          <p class="pk-small">Thank you for your patience and generous support of the PKI Consortium!</p>
        </div>
      </Alert>
    </div>
  );
}

function FailedBadge() {
  return (
    <div class="pk">
      <Alert tone="danger" title="Payment not completed">
        <div class="pk-stack pk-stack--snug">
          <p>Your bank was unable to process the payment. No funds have been charged.</p>
          <p>
            If you would like to try again, please <a href="/donate/">return to the donation page</a> and use a
            different payment method.
          </p>
        </div>
      </Alert>
    </div>
  );
}

function ExpiredBadge() {
  return (
    <div class="pk">
      <Alert tone="warn" title="Checkout session expired">
        <div class="pk-stack pk-stack--snug">
          <p>The payment window for this checkout has closed and no payment was taken.</p>
          <p>
            Please return to the donation page to <a href="/donate/">try again</a>, we really appreciate your support.
          </p>
        </div>
      </Alert>
    </div>
  );
}

function GenericThankYou({ pendingHtml }: { pendingHtml: string }) {
  // SAFETY: pendingHtml is read from Hugo-rendered static markup (data-donation-pending-content)
  return <div class="pk pk-stack" dangerouslySetInnerHTML={{ __html: pendingHtml }} />;
}

// ── Render helpers ────────────────────────────────────────────────────────

function renderTo(container: HTMLElement, content: ComponentChildren): void {
  render(content as preact.VNode, container);
  container.hidden = false;
}

function consumeDonationPollResult(
  container: HTMLElement,
  data: DonationSessionResponse,
): { stop: boolean; session: DonationSession | null } {
  const result = classifyDonationPollResult(data);
  if (result.state === "failed") {
    renderTo(container, <FailedBadge />);
    return { stop: true, session: null };
  }
  if (result.state === "expired") {
    renderTo(container, <ExpiredBadge />);
    return { stop: true, session: null };
  }
  if (result.state === "confirmed") {
    return { stop: true, session: result.session };
  }
  return { stop: false, session: null };
}

/**
 * Shows the badge, then re-renders it with the donor's own promoter link once
 * that has been issued. The link is a prop rather than a DOM mutation, so the
 * copy row and the social hrefs cannot disagree about which URL is current.
 */
function showBadgeAndPersonalizeShareLink(container: HTMLElement, session: DonationSession, sessionId: string): void {
  renderBadge(container, session, sessionId, GENERIC_SHARE_URL, false);
  void fetchPromoterCode(sessionId).then((result) => {
    if (!result) return;
    renderBadge(container, session, sessionId, result.shareUrl, true);
  });
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

  // ── fast polling (card / wallet) ─────────────────────────────
  let session: DonationSession | null = null;
  let isAsyncPayment = false;
  let asyncMethodType: string | null | undefined;
  let asyncExpiresAt: number | null | undefined;

  for (let i = 0; i < MAX_POLLS; i++) {
    try {
      const data = await getJson(
        `/api/v1/donations/session?session_id=${encodeURIComponent(sessionId)}`,
        donationSessionPollResponseSchema,
      );
      if ("asyncPayment" in data && data.asyncPayment) {
        isAsyncPayment = true;
        asyncMethodType = data.paymentMethodType;
        asyncExpiresAt = data.sessionExpiresAt;
        break;
      }
      const result = consumeDonationPollResult(container, data);
      if (result.stop) {
        if (!result.session) return;
        session = result.session;
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
    showBadgeAndPersonalizeShareLink(container, session, sessionId);
    return;
  }

  if (!isAsyncPayment) {
    renderStaticThankYou(container);
    return;
  }

  // ── async payment (bank transfer / ACH / SEPA) ───────────────
  renderTo(container, <AsyncPending methodType={asyncMethodType} expiresAt={asyncExpiresAt} />);

  const msUntilExpiry = asyncExpiresAt ? Math.max(0, asyncExpiresAt * 1000 - Date.now()) : null;
  const asyncPolls =
    msUntilExpiry !== null
      ? Math.min(ASYNC_MAX_POLLS, Math.ceil(msUntilExpiry / ASYNC_POLL_INTERVAL_MS))
      : ASYNC_MAX_POLLS;

  for (let i = 0; i < asyncPolls; i++) {
    await sleep(ASYNC_POLL_INTERVAL_MS);
    try {
      const data = await getJson(
        `/api/v1/donations/session?session_id=${encodeURIComponent(sessionId)}`,
        donationSessionPollResponseSchema,
      );
      const result = consumeDonationPollResult(container, data);
      if (result.stop) {
        if (!result.session) return;
        session = result.session;
        break;
      }
    } catch {
      // Tolerate network errors
    }
  }

  if (!session) return;

  showBadgeAndPersonalizeShareLink(container, session, sessionId);
}

// ── Badge rendering ─────────────────────────────────────────────────────

function renderBadge(
  container: HTMLElement,
  session: DonationSession,
  sessionId: string,
  shareUrl: string,
  personalized: boolean,
): void {
  renderTo(
    container,
    <DonationBadge session={session} sessionId={sessionId} shareUrl={shareUrl} personalized={personalized} />,
  );
}

function renderStaticThankYou(container: HTMLElement): void {
  const pendingEl = document.querySelector<HTMLElement>("[data-donation-pending-content]");
  const inner = pendingEl?.innerHTML?.trim() ?? "";
  renderTo(container, <GenericThankYou pendingHtml={inner} />);
}

// ── Share text ──────────────────────────────────────────────────────────

type PromoterResult = z.infer<typeof donationPromoterResponseSchema>;

async function fetchPromoterCode(sessionId: string): Promise<PromoterResult | null> {
  try {
    const payload = donationPromoterRequestSchema.parse({ sessionId });
    // Awaited rather than returned: returning the promise from inside the
    // `try` puts its rejection outside this catch, and a promoter endpoint
    // that answers 500 became an unhandled rejection instead of a badge with
    // the generic share link on it.
    return await postJson("/api/v1/donations/promoters", payload, donationPromoterResponseSchema);
  } catch {
    return null;
  }
}

function shareTextFor(formattedAmount: string): string {
  return `I just made a voluntary donation of ${formattedAmount} to the PKI Consortium to keep our memberships, resources, and events free! 🎉`;
}

function formattedAmountFor(session: DonationSession): string {
  const info = currencyInfo(session.currency);
  const majorAmount = toMajorUnit(session.grossAmount, session.currency);
  return formatCurrency(majorAmount, info.code.toUpperCase(), info.zeroDecimal ?? false);
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
