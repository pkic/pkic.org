import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../components/Badge";
import { DataTable } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { useServerCollection } from "../../../../hooks/useServerCollection";
import { loadAdminCollection } from "../../../services/server-collection";
import { Pager } from "../../../../components/Pager";
import { useEffect } from "preact/hooks";
import {
  eventPromotersListResponseSchema,
  type EventPromoter as PromoterEntry,
} from "../../../../../shared/schemas/admin-event-promoters";
import { promoterRankCardClass, promoterRankTier } from "../../../promoter-ranking";
import { useOffsetPager } from "../../../../hooks/useOffsetPager";

function conversionColor(rate: number): string {
  if (rate >= 50) return "high";
  if (rate >= 25) return "mid";
  return "low";
}

function impactColor(score: number): string {
  if (score >= 10) return "text-success";
  if (score >= 5) return "text-primary";
  return "";
}

function PromoterCard({ p, rank }: { p: PromoterEntry; rank: number }) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unknown promoter";
  const subtitle = [p.job_title, p.organization].filter(Boolean).join(" · ");
  const conversion = p.invite_conversion_rate ?? 0;
  const initials = [p.first_name?.[0], p.last_name?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  return (
    <div class={`adm-promoter-card ${promoterRankCardClass(rank)}`}>
      <div class="adm-promoter-avatar-wrap">
        {p.headshot_url ? (
          <img class="adm-promoter-avatar" src={p.headshot_url ?? undefined} alt={name} />
        ) : (
          <div class="adm-promoter-avatar adm-promoter-avatar-initials">{initials}</div>
        )}
        <span class={`adm-promoter-rank-badge ${promoterRankTier(rank)}`}>{rank}</span>
      </div>

      <div class="adm-promoter-info">
        {p.email ? (
          <a href={`mailto:${p.email}`} class="name text-decoration-none" title={p.email}>
            {name}
          </a>
        ) : (
          <span class="name">{name}</span>
        )}
        {subtitle && <div class="subtitle">{subtitle}</div>}
      </div>

      <div class="adm-promoter-stats">
        {p.invites_sent > 0 && (
          <div class="adm-promoter-group">
            <div class="adm-promoter-group-label">Invites</div>
            <div class="d-flex gap-3">
              <div class="adm-promoter-stat">
                <div class="val">{p.invites_sent}</div>
                <div class="lbl">Sent</div>
              </div>
              <div class="adm-promoter-stat">
                <div class="val text-success">{p.invites_accepted}</div>
                <div class="lbl">Accepted</div>
              </div>
              <div class="adm-promoter-stat">
                <div class="val">{conversion}%</div>
                <div class="lbl">Rate</div>
                <progress
                  class={`adm-promoter-conversion ${conversionColor(conversion)}`}
                  value={Math.min(conversion, 100)}
                  max={100}
                  aria-label={`${conversion}% invite conversion`}
                />
              </div>
            </div>
          </div>
        )}

        {p.referral_clicks > 0 && (
          <div class="adm-promoter-group">
            <div class="adm-promoter-group-label">Referrals</div>
            <div class="d-flex gap-3">
              <div class="adm-promoter-stat">
                <div class="val">{p.referral_clicks}</div>
                <div class="lbl">Clicks</div>
              </div>
              <div class="adm-promoter-stat">
                <div class="val text-success">{p.referral_conversions}</div>
                <div class="lbl">Registered</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div class="adm-promoter-stat adm-promoter-impact">
        <div class={`val fw-semibold ${impactColor(p.impact_score)}`}>{p.impact_score.toFixed(0)}</div>
        <div class="lbl">Impact</div>
      </div>

      {(p.invites_declined > 0 || p.invites_expired > 0) && (
        <div class="d-flex gap-1 flex-shrink-0">
          {p.invites_declined > 0 && <Badge status="declined" label={`${p.invites_declined} declined`} />}
          {p.invites_expired > 0 && <Badge status="expired" label={`${p.invites_expired} expired`} />}
        </div>
      )}
    </div>
  );
}

export function Promoters({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = useHashLocation();
  const tab = subTab === "codes" ? "codes" : "promoters";
  const pager = useOffsetPager();
  const { offset, pageSize } = pager;
  const { data, loading, error } = useServerCollection({
    endpoint: `/api/v1/admin/events/${slug}/promoters`,
    params: {
      view: tab,
      limit: String(pageSize),
      offset: String(offset),
      sort: tab === "promoters" ? "-impact" : "-conversions",
    },
    responseSchema: eventPromotersListResponseSchema,
    load: loadAdminCollection,
  });

  useEffect(() => pager.resetPage(), [tab, pager.resetPage]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { promoters, referralCodes, summary, page } = data;
  return (
    <div>
      {tab === "promoters" && summary.activePromoters > 0 && (
        <div class="stat-grid mb-3">
          <div class="stat-card ok">
            <div class="val">{summary.activePromoters}</div>
            <div class="lbl">Active Promoters</div>
            <div class="note">{summary.promotersWithRegistrations} with registrations</div>
          </div>
          <div class="stat-card">
            <div class="val">{summary.totalInvitesSent}</div>
            <div class="lbl">Invites Sent</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{summary.totalInvitesAccepted}</div>
            <div class="lbl">Invite Accepted</div>
            {summary.totalInvitesSent > 0 && (
              <div class="note">
                {((summary.totalInvitesAccepted / summary.totalInvitesSent) * 100).toFixed(0)}% conversion
              </div>
            )}
          </div>
          <div class="stat-card">
            <div class="val">{summary.totalReferralClicks}</div>
            <div class="lbl">Link Clicks</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{summary.totalReferralConversions}</div>
            <div class="lbl">Link Registrations</div>
          </div>
        </div>
      )}

      <Tabs
        items={[
          { key: "promoters", label: `Active Promoters (${summary.activePromoters})` },
          { key: "codes", label: `Referral Codes (${summary.referralCodeCount})` },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/promoters/${key === "promoters" ? "" : key}`)}
      />

      {tab === "promoters" &&
        (promoters.length === 0 ? (
          <div class="text-muted text-center py-4">No promoter activity yet</div>
        ) : (
          <div class="d-flex flex-column gap-2 mt-2">
            {promoters.map((p, i) => (
              <PromoterCard key={p.user_id} p={p} rank={page.offset + i + 1} />
            ))}
          </div>
        ))}

      {tab === "codes" && (
        <DataTable
          columns={[
            { header: "Code", cell: (c) => <span class="adm-referral-code">{c.code}</span> },
            {
              header: "Owner",
              cell: (c) => [c.owner_first_name, c.owner_last_name].filter(Boolean).join(" ") || c.owner_email || "—",
            },
            { header: { label: "Clicks", className: "text-end" }, cell: (c) => c.clicks, className: "mono text-end" },
            {
              header: { label: "Conversions", className: "text-end" },
              cell: (c) => c.conversions,
              className: "mono text-end",
            },
            {
              header: "Created",
              cell: (c) => (c.created_at ? c.created_at.substring(0, 10) : "—"),
              className: "mono small",
            },
          ]}
          data={referralCodes}
          empty="No referral codes issued"
          rowKey={(c) => c.code}
        />
      )}

      <Pager
        {...pager.pagerProps({
          hasMore: page.hasMore,
          rowCount: promoters.length + referralCodes.length,
          total: page.total,
          serverOffset: page.offset,
        })}
      />
    </div>
  );
}
