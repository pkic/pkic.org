import { esc, fmt, q, spinner, tbl, toast } from "./ui";
import type { ApiFn } from "./types";

export interface PromoterEntry {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  invites_sent: number;
  invites_accepted: number;
  invites_declined: number;
  invites_expired: number;
  invite_conversion_rate: number | null;
  last_invite_at: string | null;
  referral_codes_issued: number;
  referral_clicks: number;
  referral_conversions: number;
  impact_score: number;
}

export interface ReferralCodeEntry {
  code: string;
  owner_type: string;
  owner_id: string;
  effective_user_id: string | null;
  owner_email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  channel_hint: string | null;
  clicks: number;
  conversions: number;
  created_at: string;
}

export interface PromotersResponse {
  eventSlug: string;
  promoters: PromoterEntry[];
  referralCodes: ReferralCodeEntry[];
  clickTimeline: Array<{ date: string; clicks: number }>;
}

export function createPromotersSection(api: ApiFn): {
  promotersTabHtml: () => string;
  loadEventPromoters: (slug: string) => Promise<void>;
} {
  function promotersTabHtml(): string {
    return (
      '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
        '<span class="small text-muted">Ranked by impact score — invite acceptances &amp; referral conversions</span>' +
        '<button class="btn btn-sm btn-outline-secondary ms-auto" id="promo-refresh">&circlearrowright; Refresh</button>' +
      '</div>' +
      '<div id="promo-body">' + spinner() + '</div>'
    );
  }

  async function loadEventPromoters(slug: string): Promise<void> {
    const body = q("#promo-body");
    if (!body) return;

    const refreshBtn = q<HTMLButtonElement>("#promo-refresh");

    const doLoad = async (): Promise<void> => {
      body.innerHTML = spinner();
      try {
        const d = await api<PromotersResponse>(`/api/v1/admin/events/${slug}/promoters`);

        // ── Promoter leaderboard table ──────────────────────────────────────
        const top100 = d.promoters.slice(0, 100);
        const promoterRows = top100.map((p, idx) => {
          const displayName = [p.first_name, p.last_name].filter(Boolean).join(" ");
          const nameCell = displayName
            ? `${esc(displayName)}<br><span class="mono text-muted" style="font-size:.75rem">${esc(p.email ?? "")}</span>`
            : `<span class="mono">${esc(p.email ?? p.user_id)}</span>`;
          const convRate = p.invite_conversion_rate !== null ? `${p.invite_conversion_rate}%` : "—";
          const medal = idx === 0 ? " \uD83E\uDD47" : idx === 1 ? " \uD83E\uDD48" : idx === 2 ? " \uD83E\uDD49" : "";
          return (
            `<tr>` +
            `<td class="text-center fw-bold mono">${medal || idx + 1}</td>` +
            `<td style="font-size:.85rem">${nameCell}</td>` +
            `<td class="text-center mono">${p.invites_sent}</td>` +
            `<td class="text-center"><span class="badge text-bg-success">${p.invites_accepted}</span></td>` +
            `<td class="text-center"><span class="badge text-bg-danger">${p.invites_declined}</span></td>` +
            `<td class="text-center mono">${convRate}</td>` +
            `<td class="text-center mono">${p.referral_clicks}</td>` +
            `<td class="text-center"><span class="badge text-bg-primary">${p.referral_conversions}</span></td>` +
            `<td class="text-center fw-semibold">${p.impact_score}</td>` +
            `<td class="mono small text-muted">${p.last_invite_at ? fmt(p.last_invite_at) : "—"}</td>` +
            `</tr>`
          );
        });

        // ── Click timeline ──────────────────────────────────────────────────
        const timelineHtml = d.clickTimeline.length > 0
          ? tbl(
              ["Date", "Clicks"],
              d.clickTimeline.map((row) =>
                `<tr><td class="mono">${esc(row.date)}</td><td class="mono">${row.clicks}</td></tr>`,
              ),
              "No clicks yet",
            )
          : '<p class="text-muted fst-italic small">No referral link clicks recorded in the last 30 days.</p>';

        body.innerHTML =
          '<h6 class="text-uppercase small fw-bold text-muted mb-2">Top Promoters &amp; Inviters' +
          (d.promoters.length > 100 ? ` <span class="fw-normal">(showing top 100 of ${d.promoters.length})</span>` : '') +
          '</h6>' +
          tbl(
            ["#", "Person", "Sent", "Accepted", "Declined", "Conv. Rate", "Link Clicks", "Link Conv.", "Impact", "Last Invite"],
            promoterRows,
            "No invite or referral activity yet — send invites or share referral links to see data here.",
          ) +
          '<hr class="my-3">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-2">Click Activity (last 30 days)</h6>' +
          timelineHtml;
      } catch (err) {
        body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
      }
    };

    // Wire refresh button once
    const bodyEl = body as HTMLElement;
    if (!bodyEl.dataset.promoWired) {
      bodyEl.dataset.promoWired = "1";
      refreshBtn?.addEventListener("click", () => void doLoad());
    }

    await doLoad();
  }


  return { promotersTabHtml, loadEventPromoters };
}
