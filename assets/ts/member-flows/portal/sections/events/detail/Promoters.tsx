import { usePortalHashLocation } from "../../../hash-location";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Badge } from "../../../../../components/Badge";
import { DataTable } from "../../../../../components/Table";
import { Tabs } from "../../../../../components/Tabs";
import {
  buildCollectionResetKey,
  useCollectionOffset,
  useServerCollection,
  type CollectionLoader,
} from "../../../../../hooks/useServerCollection";
import { Pager } from "../../../../../components/Pager";
import {
  eventPromotersListResponseSchema,
  type EventPromoter as PromoterEntry,
} from "../../../../../../shared/schemas/event-promoters";
import { promoterRankCardClass, promoterRankTier } from "../../../../../shared/donation/promoter-ranking";
import { useOffsetPager } from "../../../../../hooks/useOffsetPager";
import { getJson } from "../../../../../shared/api-client";

const loadEventPromoters: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

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
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Unknown promoter";
  const subtitle = [p.jobTitle, p.organization].filter(Boolean).join(" · ");
  const conversion = p.inviteConversionRate ?? 0;
  const initials = [p.firstName?.[0], p.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "?";

  return (
    <div class={`adm-promoter-card ${promoterRankCardClass(rank)}`}>
      <div class="adm-promoter-avatar-wrap">
        {p.headshotUrl ? (
          <img class="adm-promoter-avatar" src={p.headshotUrl ?? undefined} alt={name} />
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
        {p.invitesSent > 0 && (
          <div class="adm-promoter-group">
            <div class="adm-promoter-group-label">Invites</div>
            <div class="d-flex gap-3">
              <div class="adm-promoter-stat">
                <div class="val">{p.invitesSent}</div>
                <div class="lbl">Sent</div>
              </div>
              <div class="adm-promoter-stat">
                <div class="val text-success">{p.invitesAccepted}</div>
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

        {p.referralClicks > 0 && (
          <div class="adm-promoter-group">
            <div class="adm-promoter-group-label">Referrals</div>
            <div class="d-flex gap-3">
              <div class="adm-promoter-stat">
                <div class="val">{p.referralClicks}</div>
                <div class="lbl">Clicks</div>
              </div>
              <div class="adm-promoter-stat">
                <div class="val text-success">{p.referralConversions}</div>
                <div class="lbl">Registered</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div class="adm-promoter-stat adm-promoter-impact">
        <div class={`val fw-semibold ${impactColor(p.impactScore)}`}>{p.impactScore.toFixed(0)}</div>
        <div class="lbl">Impact</div>
      </div>

      {(p.invitesDeclined > 0 || p.invitesExpired > 0) && (
        <div class="d-flex gap-1 flex-shrink-0">
          {p.invitesDeclined > 0 && <Badge status="declined" label={`${p.invitesDeclined} declined`} />}
          {p.invitesExpired > 0 && <Badge status="expired" label={`${p.invitesExpired} expired`} />}
        </div>
      )}
    </div>
  );
}

export function Promoters({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = usePortalHashLocation();
  const tab = subTab === "codes" ? "codes" : "promoters";
  const pager = useOffsetPager();
  const { offset, pageSize } = pager;
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/promoters`;
  const sort = tab === "promoters" ? "-impact" : "-conversions";
  const resetKey = buildCollectionResetKey(endpoint, { view: tab, sort });
  const requestOffset = useCollectionOffset(resetKey, offset, pager.resetPage);
  const { data, loading, error } = useServerCollection({
    endpoint,
    params: {
      view: tab,
      limit: String(pageSize),
      offset: String(requestOffset),
      sort,
    },
    responseSchema: eventPromotersListResponseSchema,
    load: loadEventPromoters,
  });

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
        hrefFor={(key) => `/events/${slug}/promoters/${key === "promoters" ? "" : key}`}
      />

      {tab === "promoters" &&
        (promoters.length === 0 ? (
          <div class="text-muted text-center py-4">No promoter activity yet</div>
        ) : (
          <div class="d-flex flex-column gap-2 mt-2">
            {promoters.map((p, i) => (
              <PromoterCard key={p.userId} p={p} rank={page.offset + i + 1} />
            ))}
          </div>
        ))}

      {tab === "codes" && (
        <DataTable
          columns={[
            { header: "Code", cell: (c) => <span class="adm-referral-code">{c.code}</span> },
            {
              header: "Owner",
              cell: (c) => [c.ownerFirstName, c.ownerLastName].filter(Boolean).join(" ") || c.ownerEmail || "—",
            },
            { header: { label: "Clicks", className: "text-end" }, cell: (c) => c.clicks, className: "mono text-end" },
            {
              header: { label: "Conversions", className: "text-end" },
              cell: (c) => c.conversions,
              className: "mono text-end",
            },
            {
              header: "Created",
              cell: (c) => c.createdAt.substring(0, 10),
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
