import { asyncPaymentWindow } from "../../shared/constants/async-payment-window";

interface DonationRow {
  id: string;
  checkout_session_id: string;
  payment_intent_id: string | null;
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
  net_amount: number | null;
  source: string | null;
  status: string;
  payment_method_type: string | null;
  session_expires_at: number | null;
  created_at: string;
  completed_at: string | null;
}

interface DonationsResponse {
  donations: DonationRow[];
  summary: Record<string, number>;
  limit: number;
  offset: number;
}

interface DonationSyncResult {
  sessionId: string;
  outcome: "completed" | "expired" | "awaiting_payment" | "failed" | "still_pending" | "error";
  error?: string;
}

interface DonationSyncResponse {
  synced: number;
  completed: number;
  expired: number;
  failed: number;
  errors: number;
  results: DonationSyncResult[];
}

type ToastType = "success" | "error" | "info";

interface DonationsSectionDeps {
  api<T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }): Promise<T>;
  badge(status: string): string;
  esc(value: unknown): string;
  fmt(value: string | null | undefined): string;
  q<T extends Element = Element>(selector: string, context?: ParentNode): T | null;
  spinner(): string;
  tbl(heads: string[], rows: string[], empty?: string): string;
  toast(message: string, type?: ToastType): void;
}

const DONATION_FILTERS = ["", "pending", "awaiting_payment", "completed", "expired", "failed"] as const;
const ZERO_DECIMAL_CURRENCIES = new Set(["bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

function fmtAmount(smallestUnit: number, currency: string): string {
  const currencyCode = currency.toLowerCase();
  const major = ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? smallestUnit : smallestUnit / 100;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? 0 : 2,
    }).format(major);
  } catch {
    return `${major} ${currency.toUpperCase()}`;
  }
}

export function createDonationsSection(deps: DonationsSectionDeps): { loadDonations: (filter?: string) => Promise<void> } {
  const { api, badge, esc, fmt, q, spinner, tbl, toast } = deps;
  let donationFilter = "";

  async function loadDonations(filter?: string): Promise<void> {
    const el = q("#don-body");
    if (!el) return;
    if (filter !== undefined) donationFilter = filter;
    el.innerHTML = spinner();

    try {
      const qs = donationFilter ? `?status=${encodeURIComponent(donationFilter)}` : "";
      const data = await api<DonationsResponse>(`/api/v1/admin/donations${qs}`);

      const total = Object.values(data.summary).reduce((sum, value) => sum + value, 0);
      const pending = (data.summary.pending ?? 0) + (data.summary.awaiting_payment ?? 0);
      const backfillable = data.donations.filter((donation) =>
        donation.status === "completed" && (donation.net_amount === null || donation.payment_method_type === null),
      ).length;
      const syncable = pending + backfillable;
      const failed = data.summary.failed ?? 0;

      const filterBtns = DONATION_FILTERS.map((status) => {
        const active = donationFilter === status ? " active" : "";
        const label = status === "" ? "All" : status === "awaiting_payment" ? "Awaiting" : status.charAt(0).toUpperCase() + status.slice(1);
        const count = status === "" ? total : (data.summary[status] ?? 0);
        return `<button class="btn btn-sm btn-outline-secondary${active}" data-don-filter="${status}">${label} <span class="badge text-bg-secondary">${count}</span></button>`;
      }).join(" ");

      const rows = data.donations.map((donation) => renderDonationRow(donation));

      el.innerHTML =
        `<ul class="nav nav-tabs mb-3" id="don-tabs" role="tablist">` +
          `<li class="nav-item"><button class="nav-link active" data-don-tab="list">Donations</button></li>` +
          `<li class="nav-item"><button class="nav-link" data-don-tab="promoters">Share Links</button></li>` +
        `</ul>` +
        `<div id="don-tab-list">` +
          `<div class="d-flex align-items-center gap-2 mb-3 flex-wrap">` +
            filterBtns +
            `<div class="ms-auto d-flex gap-2">` +
              `<button class="btn btn-sm btn-success" id="btn-don-sync-pending">↺ Sync all (${syncable})</button>` +
              (failed > 0 ? `<span class="badge text-bg-danger ms-1" title="Payment failed">${failed} failed</span>` : "") +
            `</div>` +
          `</div>` +
          tbl(
            ["Session ID", "Donor", "Amount", "Status", "Method", "Source", "Created", "Completed"],
            rows,
            "No donations found",
          ) +
        `</div>` +
        `<div id="don-tab-promoters" class="d-none">` +
          `<div class="d-flex justify-content-end mb-2">` +
            `<button class="btn btn-sm btn-outline-secondary" id="btn-promoters-refresh">↺ Refresh</button>` +
          `</div>` +
          `<div id="don-promoters-body"></div>` +
        `</div>`;

      wireDonationTabs(el);
      wireDonationFilters(el);
      wireDonationSyncButtons(el);
      wireDonationSyncAll(syncable);

      void loadDonationPromoters();
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  function renderDonationRow(donation: DonationRow): string {
    const donationBadge = badge(donation.status);
    const gross = fmtAmount(donation.gross_amount, donation.currency);
    const net = donation.net_amount !== null ? fmtAmount(donation.net_amount, donation.currency) : "—";
    const syncBtn = donation.status === "pending" || donation.status === "awaiting_payment" ||
      (donation.status === "completed" && (donation.net_amount === null || donation.payment_method_type === null))
      ? `<button class="btn btn-xs btn-outline-primary adm-donation-action-btn btn-don-sync" data-session="${esc(donation.checkout_session_id)}">Sync</button>`
      : "";
    const badgeUrl = `/api/v1/og/donation/${encodeURIComponent(donation.checkout_session_id)}?name=${encodeURIComponent(donation.name)}`;
    const badgeBtn = donation.status === "completed"
      ? `<a class="btn btn-xs btn-outline-secondary adm-donation-action-btn" href="${esc(badgeUrl)}" download="${esc(donation.name.replace(/[^\w\s-]/g, ""))}-donation-badge.jpeg">🖼 Badge</a>`
      : "";
    const methodLabel = donation.payment_method_type ? asyncPaymentWindow(donation.payment_method_type).label : "—";
    const deadline = donation.status === "awaiting_payment" && donation.session_expires_at
      ? `<br><small class="text-muted">due ${new Date(donation.session_expires_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small>`
      : "";

    return `<tr>
      <td class="mono small">${esc(donation.checkout_session_id.slice(0, 24))}…</td>
      <td>${esc(donation.name)}<br><small class="text-muted">${esc(donation.email)}</small>${donation.organization ? `<br><small class="text-muted">${esc(donation.organization)}</small>` : ""}</td>
      <td>${gross}<br><small class="text-muted">Net: ${net}</small></td>
      <td>${donationBadge} ${syncBtn}${badgeBtn}</td>
      <td class="small">${esc(methodLabel)}${deadline}</td>
      <td class="small text-muted">${donation.source ? esc(donation.source) : "—"}</td>
      <td class="small text-muted">${fmt(donation.created_at)}</td>
      <td class="small text-muted">${fmt(donation.completed_at)}</td>
    </tr>`;
  }

  function wireDonationTabs(el: Element): void {
    el.querySelectorAll<HTMLButtonElement>("[data-don-tab]").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        el.querySelectorAll<HTMLButtonElement>("[data-don-tab]").forEach((button) => button.classList.remove("active"));
        tabBtn.classList.add("active");
        const tab = tabBtn.dataset.donTab!;
        el.querySelectorAll<HTMLElement>("[id^='don-tab-']").forEach((pane) => {
          pane.classList.toggle("d-none", pane.id !== `don-tab-${tab}`);
        });
        if (tab === "promoters") void loadDonationPromoters();
      });
    });

    el.querySelector<HTMLButtonElement>("#btn-promoters-refresh")?.addEventListener("click", () => void loadDonationPromoters());
  }

  function wireDonationFilters(el: Element): void {
    el.querySelectorAll<HTMLButtonElement>("[data-don-filter]").forEach((btn) => {
      btn.addEventListener("click", () => void loadDonations(btn.dataset.donFilter!));
    });
  }

  function wireDonationSyncButtons(el: Element): void {
    el.querySelectorAll<HTMLButtonElement>(".btn-don-sync").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sessionId = btn.dataset.session!;
        btn.disabled = true;
        btn.textContent = "…";
        api<DonationSyncResponse>("/api/v1/admin/donations/sync", {
          method: "POST",
          body: JSON.stringify({ sessionIds: [sessionId] }),
        })
          .then((res) => {
            const result = res.results[0];
            if (result?.outcome === "completed") toast("Donation marked as completed.", "success");
            else if (result?.outcome === "awaiting_payment") toast("Payment initiated — awaiting bank settlement.", "info");
            else if (result?.outcome === "expired") toast("Session expired — donation marked expired.", "info");
            else if (result?.outcome === "failed") toast("Payment failed — bank declined or bounced.", "error");
            else if (result?.outcome === "still_pending") toast("Session still pending on Stripe.", "info");
            else toast(result?.error ?? "Sync failed.", "error");
            void loadDonations();
          })
          .catch((err: Error) => {
            toast(err.message, "error");
            btn.disabled = false;
            btn.textContent = "Sync";
          });
      });
    });
  }

  function wireDonationSyncAll(syncable: number): void {
    q<HTMLButtonElement>("#btn-don-sync-pending")?.addEventListener("click", () => {
      if (syncable === 0) {
        toast("No donations to sync.", "info");
        return;
      }

      const btn = q<HTMLButtonElement>("#btn-don-sync-pending");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Syncing…";
      }

      api<DonationSyncResponse>("/api/v1/admin/donations/sync", { method: "POST" })
        .then((res) => {
          const parts = [
            res.completed ? `${res.completed} completed` : "",
            res.failed ? `${res.failed} failed` : "",
            res.expired ? `${res.expired} expired` : "",
            res.errors ? `${res.errors} errors` : "",
          ].filter(Boolean).join(", ");
          toast(
            `Synced ${res.synced}${parts ? `: ${parts}` : "."}`,
            res.errors > 0 || res.failed > 0 ? "error" : "success",
          );
          void loadDonations();
        })
        .catch((err: Error) => {
          toast(err.message, "error");
          void loadDonations();
        });
    });
  }

  async function loadDonationPromoters(): Promise<void> {
    const el = q("#don-promoters-body");
    if (!el) return;
    el.innerHTML = spinner();

    try {
      const data = await api<{ promoters: Array<{
        code: string;
        name: string | null;
        checkout_session_id: string | null;
        clicks: number;
        attributed_total: number;
        attributed_completed: number;
        attributed_gross: number;
        currency: string | null;
        created_at: string;
      }> }>("/api/v1/admin/donations/promoters");

      const appBase = window.location.origin;
      el.innerHTML = tbl(
        ["Name", "Share URL", "Clicks", "Attributed (compl.)", "Attributed Gross", "Created"],
        data.promoters.map((promoter) => {
          const shareUrl = `${appBase}/donate/r/${esc(promoter.code)}`;
          const gross = promoter.attributed_gross > 0 && promoter.currency
            ? fmtAmount(promoter.attributed_gross, promoter.currency)
            : "—";
          return `<tr>
            <td>${promoter.name ? esc(promoter.name) : `<span class="text-muted fst-italic">anonymous</span>`}</td>
            <td class="mono small"><a href="${esc(shareUrl)}" target="_blank" rel="noopener">/donate/r/${esc(promoter.code)}</a></td>
            <td>${promoter.clicks}</td>
            <td>${promoter.attributed_completed} / ${promoter.attributed_total}</td>
            <td class="mono">${gross}</td>
            <td class="small text-muted">${fmt(promoter.created_at)}</td>
          </tr>`;
        }),
        "No promoter links yet",
      );
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  return { loadDonations };
}
