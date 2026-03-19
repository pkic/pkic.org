/**
 * Donation form logic — initialises the donation widget rendered by the
 * `donation-form.html` Hugo shortcode.
 *
 * On load it auto-detects the visitor's country via `/api/v1/geo` and maps
 * it to a default currency. The donor can switch currencies via a `<select>`.
 * Preset amount buttons (50/100/250/500/1000) and a custom-amount input are
 * provided. Clicking "Donate" creates a Stripe Checkout Session via the
 * backend and mounts Stripe Embedded Checkout inline.
 *
 * Donor identity (name, email, organisation) is collected in the form and
 * submitted to the backend for tax-reporting purposes. When context is
 * available (e.g. the user just registered for an event) the fields are
 * pre-filled via data attributes or URL query parameters.
 */
import { postJson, getJson } from "./api-client";
import {
  CURRENCIES,
  currencyForCountry,
  currencyInfo,
  toSmallestUnit,
  type CurrencyInfo,
} from "../../shared/constants/currencies";

const PRESET_AMOUNTS = [50, 100, 250, 500, 1000];
const API_BASE = "/api/v1";

interface DonationConfig {
  /** Pre-fill the donor's full name. */
  name?: string;
  /** Pre-fill the Stripe Checkout email field. */
  email?: string;
  /** Pre-fill the donor's organisation. */
  organizationName?: string;
  /** URL path or label indicating where the donation was initiated. */
  source?: string;
  /** Relative path for redirect after successful donation. */
  successPath?: string;
  /** Relative path for redirect if donor cancels. */
  cancelPath?: string;
}

/**
 * Initialise every `[data-donation-form]` element on the page.
 * Called at module-level (deferred script).
 */
export function initDonationForms(): void {
  document.querySelectorAll<HTMLElement>("[data-donation-form]").forEach((root) => {
    initForm(root);
  });
}

/**
 * Initialise a single donation form root element.
 * Safe to call on dynamically injected elements (e.g. in the registration
 * success panel) after the DOM is already loaded.
 */
export function initDonationForm(root: HTMLElement): void {
  void initForm(root);
}

function readConfig(root: HTMLElement): DonationConfig {
  // Read from data attributes first, fall back to URL query params so the
  // standalone /donate/ page can receive context via ?name=…&email=…&event=… links.
  const params = new URLSearchParams(window.location.search);
  return {
    name: root.dataset.donationName || params.get("name") || undefined,
    email: root.dataset.donationEmail || params.get("email") || undefined,
    organizationName: root.dataset.donationOrganization || params.get("org") || undefined,
    source: params.get("source") || window.location.pathname,
    successPath: root.dataset.donationSuccessPath || undefined,
    cancelPath: root.dataset.donationCancelPath || undefined,
  };
}

async function initForm(root: HTMLElement): Promise<void> {
  const config = readConfig(root);

  // ── Detect currency from geo ───────────────────────────────────────────
  let defaultCurrency = "usd";
  try {
    const geo = await getJson<{ country: string | null }>(`${API_BASE}/geo`);
    defaultCurrency = currencyForCountry(geo.country);
  } catch {
    // Geo detection is best-effort; default to USD
  }

  // ── State ──────────────────────────────────────────────────────────────
  let selectedCurrency = defaultCurrency;
  let selectedAmount: number | null = null; // major units (e.g. 100 = $100)
  let isCustom = false;

  // ── Build UI ───────────────────────────────────────────────────────────
  const nameInput = root.querySelector<HTMLInputElement>("[data-donation-name-input]");
  const emailInput = root.querySelector<HTMLInputElement>("[data-donation-email-input]");
  const orgInput = root.querySelector<HTMLInputElement>("[data-donation-org-input]");
  const currencySelect = root.querySelector<HTMLSelectElement>("[data-donation-currency]");
  const presetContainer = root.querySelector<HTMLElement>("[data-donation-presets]");
  const customInput = root.querySelector<HTMLInputElement>("[data-donation-custom-input]");
  const customPrefix = root.querySelector<HTMLElement>("[data-donation-currency-prefix]");
  const donateBtn = root.querySelector<HTMLButtonElement>("[data-donation-submit]");
  const statusEl = root.querySelector<HTMLElement>("[data-donation-status]");

  // The checkout container and back button live alongside the form in the wrapper div.
  const widget = root.parentElement;
  const checkoutContainer = widget?.querySelector<HTMLElement>("[data-donation-checkout]") ?? null;
  const checkoutMount = widget?.querySelector<HTMLElement>("[data-donation-checkout-mount]") ?? null;
  const backBtn = widget?.querySelector<HTMLButtonElement>("[data-donation-back]") ?? null;

  if (!currencySelect || !presetContainer || !customInput || !donateBtn) return;

  // ── Pre-fill identity fields from config ───────────────────────────────
  if (nameInput && config.name) nameInput.value = config.name;
  if (emailInput && config.email) emailInput.value = config.email;
  if (orgInput && config.organizationName) orgInput.value = config.organizationName;

  // ── Populate currency dropdown ─────────────────────────────────────────
  populateCurrencySelect(currencySelect, selectedCurrency);

  // ── Render preset buttons ──────────────────────────────────────────────
  renderPresets(presetContainer, selectedCurrency);

  // ── Update display for initial currency ────────────────────────────────
  updateCurrencyDisplay();

  // ── Currency change handler ────────────────────────────────────────────
  currencySelect.addEventListener("change", () => {
    selectedCurrency = currencySelect.value;
    renderPresets(presetContainer, selectedCurrency);
    updateCurrencyDisplay();
    // Re-select the same preset amount if one was active
    if (!isCustom && selectedAmount !== null) {
      activatePreset(presetContainer, selectedAmount);
    }
  });

  // ── Preset button clicks ──────────────────────────────────────────────
  presetContainer.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-preset-amount]");
    if (!btn) return;
    selectedAmount = Number(btn.dataset.presetAmount);
    isCustom = false;
    customInput.value = "";
    activatePreset(presetContainer, selectedAmount);
    clearStatus();
  });

  // ── Custom amount input ────────────────────────────────────────────────
  customInput.addEventListener("input", () => {
    const val = parseFloat(customInput.value);
    if (val > 0) {
      selectedAmount = val;
      isCustom = true;
      clearPresetSelection(presetContainer);
    } else {
      if (isCustom) selectedAmount = null;
    }
    clearStatus();
  });

  customInput.addEventListener("focus", () => {
    clearPresetSelection(presetContainer);
    isCustom = true;
  });

  // ── Donate button ──────────────────────────────────────────────────
  donateBtn.addEventListener("click", async () => {
    // Validate identity
    const name = nameInput?.value.trim() ?? "";
    if (!name) {
      showStatus("Please enter your full name.", true);
      nameInput?.focus();
      return;
    }

    if (!selectedAmount || selectedAmount <= 0) {
      showStatus("Please select or enter a donation amount.", true);
      return;
    }

    const info = currencyInfo(selectedCurrency);
    const minMajor = info.zeroDecimal ? 100 : 1;
    if (selectedAmount < minMajor) {
      showStatus(`Minimum donation is ${info.symbol}${minMajor}.`, true);
      return;
    }

    donateBtn.disabled = true;
    const originalText = donateBtn.textContent;
    donateBtn.textContent = "Loading…";
    clearStatus();

    const email = emailInput?.value.trim() || undefined;
    const organizationName = orgInput?.value.trim() || undefined;

    try {
      const smallestUnit = toSmallestUnit(selectedAmount, selectedCurrency);
      const res = await postJson<{ clientSecret: string; publishableKey: string }>(
        `${API_BASE}/donations/checkout`,
        {
          amount: smallestUnit,
          currency: selectedCurrency,
          name,
          email,
          organizationName,
          successPath: config.successPath || undefined,
          cancelPath: config.cancelPath || undefined,
          metadata: config.source ? { source: config.source } : undefined,
          embedded: true,
        },
      );
      await mountEmbeddedCheckout(res.clientSecret, res.publishableKey);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      showStatus(message, true);
      donateBtn.disabled = false;
      donateBtn.textContent = originalText;
    }
  });

  // ── Back button ────────────────────────────────────────────────────────
  backBtn?.addEventListener("click", () => {
    destroyEmbeddedCheckout();
    showForm();
  });

  // ── Embedded Checkout lifecycle ────────────────────────────────────────

  let embeddedCheckout: { destroy(): void } | null = null;

  function showForm(): void {
    root.hidden = false;
    if (checkoutContainer) checkoutContainer.hidden = true;
    if (checkoutMount) checkoutMount.innerHTML = "";
    donateBtn.disabled = false;
    donateBtn.textContent = "Donate";
  }

  function showCheckout(): void {
    root.hidden = true;
    if (checkoutContainer) checkoutContainer.hidden = false;
  }

  function destroyEmbeddedCheckout(): void {
    if (embeddedCheckout) {
      embeddedCheckout.destroy();
      embeddedCheckout = null;
    }
  }

  async function mountEmbeddedCheckout(clientSecret: string, publishableKey: string): Promise<void> {
    if (!checkoutMount) {
      throw new Error("Embedded checkout container not found");
    }
    const stripe = await loadStripe(publishableKey);
    const checkout = await stripe.initEmbeddedCheckout({
      fetchClientSecret: () => Promise.resolve(clientSecret),
    });
    embeddedCheckout = checkout;
    showCheckout();
    checkout.mount(checkoutMount);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function updateCurrencyDisplay(): void {
    const info = currencyInfo(selectedCurrency);
    if (customPrefix) customPrefix.textContent = info.symbol;
    if (donateBtn && selectedAmount && !isCustom) {
      donateBtn.textContent = `Donate ${formatAmount(selectedAmount, info)}`;
    } else {
      donateBtn!.textContent = "Donate";
    }
  }

  function showStatus(msg: string, isError: boolean): void {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = false;
    statusEl.className = `donation-form-status small mt-2 ${isError ? "text-danger" : "text-success"}`;
  }

  function clearStatus(): void {
    if (!statusEl) return;
    statusEl.textContent = "";
    statusEl.hidden = true;
  }
}

// ── Pure rendering helpers ──────────────────────────────────────────────────

function populateCurrencySelect(select: HTMLSelectElement, defaultCode: string): void {
  select.innerHTML = "";
  for (const c of CURRENCIES) {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.code.toUpperCase()} (${c.symbol}) — ${c.name}`;
    if (c.code === defaultCode) opt.selected = true;
    select.appendChild(opt);
  }
}

/**
 * Round an amount to a visually clean number appropriate for its magnitude.
 * Used when converting USD preset amounts to other currencies.
 */
function niceRound(amount: number): number {
  if (amount < 10)      return Math.max(1, Math.round(amount));
  if (amount < 50)      return Math.round(amount / 5) * 5;
  if (amount < 250)     return Math.round(amount / 10) * 10;
  if (amount < 1000)    return Math.round(amount / 50) * 50;
  if (amount < 5000)    return Math.round(amount / 100) * 100;
  if (amount < 25000)   return Math.round(amount / 500) * 500;
  if (amount < 100000)  return Math.round(amount / 1000) * 1000;
  if (amount < 500000)  return Math.round(amount / 5000) * 5000;
  return Math.round(amount / 10000) * 10000;
}

function renderPresets(container: HTMLElement, currencyCode: string): void {
  const info = currencyInfo(currencyCode);
  const rate = info.approxUsdRate ?? 1;
  // If the currency is within 25% of USD, keep the same preset amounts for cleanliness.
  const effectiveRate = Math.abs(rate - 1) < 0.25 ? 1 : rate;
  // Scale USD base amounts to local currency and round to clean numbers.
  const amounts = Array.from(new Set(PRESET_AMOUNTS.map((usd) => niceRound(usd * effectiveRate))));
  container.innerHTML = amounts
    .map(
      (amt) =>
        `<button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="${amt}">${formatAmount(amt, info)}</button>`,
    )
    .join("");
}

function activatePreset(container: HTMLElement, amount: number): void {
  container.querySelectorAll<HTMLButtonElement>("[data-preset-amount]").forEach((btn) => {
    const isMatch = Number(btn.dataset.presetAmount) === amount;
    btn.classList.toggle("active", isMatch);
    btn.setAttribute("aria-pressed", String(isMatch));
  });
}

function clearPresetSelection(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>("[data-preset-amount]").forEach((btn) => {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  });
}

function formatAmount(amount: number, info: CurrencyInfo): string {
  // Use Intl.NumberFormat for locale-aware formatting when possible.
  // Fall back to simple symbol+number for environments without it.
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: info.code.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: info.zeroDecimal ? 0 : 2,
    }).format(amount);
  } catch {
    return `${info.symbol}${amount}`;
  }
}

// ── Stripe.js loader ─────────────────────────────────────────────────────────

type StripeInstance = {
  initEmbeddedCheckout(options: { fetchClientSecret: () => Promise<string> }): Promise<{
    mount(container: HTMLElement): void;
    destroy(): void;
  }>;
};

type StripeConstructor = (publishableKey: string) => StripeInstance;

let stripeScriptLoad: Promise<void> | null = null;

function ensureStripeScript(): Promise<void> {
  if (!stripeScriptLoad) {
    stripeScriptLoad = new Promise<void>((resolve, reject) => {
      // Already loaded by another form instance or prior navigation
      if (typeof (window as unknown as Record<string, unknown>)["Stripe"] === "function") {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      script.onload = () => resolve();
      script.onerror = () => {
        stripeScriptLoad = null; // allow retry on next attempt
        reject(new Error("Failed to load Stripe.js"));
      };
      document.head.appendChild(script);
    });
  }
  return stripeScriptLoad;
}

async function loadStripe(publishableKey: string): Promise<StripeInstance> {
  await ensureStripeScript();
  const Stripe = (window as unknown as Record<string, unknown>)["Stripe"] as StripeConstructor | undefined;
  if (typeof Stripe !== "function") {
    throw new Error("Stripe.js did not expose a Stripe constructor");
  }
  return Stripe(publishableKey);
}

// ── Auto-init on DOMContentLoaded (deferred script) ──────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDonationForms);
} else {
  initDonationForms();
}

