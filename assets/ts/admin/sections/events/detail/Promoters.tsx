import { useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../components/Badge";
import { DataTable } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { useData } from "../../../../hooks/useData";

interface PromoterEntry {
  user_id: string;
  email: string;
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

interface ReferralCodeEntry {
  code: string;
  user_email: string;
  clicks: number;
  conversions: number;
  created_at: string;
}

interface PromotersResponse {
  eventSlug: string;
  promoters: PromoterEntry[];
  referralCodes: ReferralCodeEntry[];
  clickTimeline: unknown;
}

const RANK_CLASS: Record<number, string> = { 1: "gold", 2: "silver", 3: "bronze" };
const RANK_CARD: Record<number, string> = { 1: "top-1", 2: "top-2", 3: "top-3" };

function rankTier(rank: number): string {
  if (rank <= 3) return RANK_CLASS[rank];
  if (rank <= 10) return "top-ten";
  return "other";
}

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
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
  const conversion = p.invite_conversion_rate ?? 0;

  return (
    <div class={`adm-promoter-card ${RANK_CARD[rank] ?? (rank <= 10 ? "top-ten" : "")}`}>
      <div class={`adm-promoter-rank ${rankTier(rank)}`}>
        {rank}
      </div>
      <div class="adm-promoter-info">
        <div class="name">{name}</div>
        {name !== p.email && <div class="email">{p.email}</div>}
      </div>
      <div class="adm-promoter-stats">
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
              <div class={`adm-promoter-conversion ${conversionColor(conversion)}`}>
                <div class="fill" style={{ width: `${Math.min(conversion, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
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
        <div class="adm-promoter-stat adm-promoter-impact">
          <div class={`val fw-semibold ${impactColor(p.impact_score)}`}>{p.impact_score.toFixed(1)}</div>
          <div class="lbl">Impact</div>
        </div>
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

export function Promoters({ slug }: { slug: string }) {
  const { data, loading, error } = useData<PromotersResponse>(
    () => api<PromotersResponse>(`/api/v1/admin/events/${slug}/promoters`), [slug],
  );
  const [tab, setTab] = useState<"promoters" | "codes">("promoters");

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { promoters, referralCodes } = data;

  // Summary stats
  const totalSent = promoters.reduce((s, p) => s + p.invites_sent, 0);
  const totalAccepted = promoters.reduce((s, p) => s + p.invites_accepted, 0);
  const totalClicks = promoters.reduce((s, p) => s + p.referral_clicks, 0);
  const totalConversions = promoters.reduce((s, p) => s + p.referral_conversions, 0);

  return (
    <div>
      {tab === "promoters" && promoters.length > 0 && (
        <div class="stat-grid mb-3">
          <div class="stat-card ok">
            <div class="val">{promoters.length}</div>
            <div class="lbl">Promoters</div>
          </div>
          <div class="stat-card">
            <div class="val">{totalSent}</div>
            <div class="lbl">Invites Sent</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{totalAccepted}</div>
            <div class="lbl">Accepted</div>
            {totalSent > 0 && <div class="note">{((totalAccepted / totalSent) * 100).toFixed(0)}% conversion</div>}
          </div>
          <div class="stat-card">
            <div class="val">{totalClicks}</div>
            <div class="lbl">Referral Clicks</div>
          </div>
          <div class="stat-card ok">
            <div class="val">{totalConversions}</div>
            <div class="lbl">Conversions</div>
          </div>
        </div>
      )}

      <Tabs
        items={[
          { key: "promoters", label: `Top Promoters (${promoters.length})` },
          { key: "codes", label: `Referral Codes (${referralCodes.length})` },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "promoters" | "codes")}
      />

      {tab === "promoters" && (
        promoters.length === 0
          ? <div class="text-muted text-center py-4">No promoter activity yet</div>
          : <div class="d-flex flex-column gap-2 mt-2">
              {promoters.slice(0, 100).map((p, i) => (
                <PromoterCard key={p.user_id} p={p} rank={i + 1} />
              ))}
              {promoters.length > 100 && (
                <div class="text-muted text-center small py-2">
                  Showing top 100 of {promoters.length} promoters — stats above reflect all.
                </div>
              )}
            </div>
      )}

      {tab === "codes" && (
        <DataTable
          columns={[
            { header: "Code", cell: (c) => <span class="adm-referral-code">{c.code}</span> },
            { header: "Owner", cell: (c) => c.user_email },
            { header: { label: "Clicks", className: "text-end" }, cell: (c) => c.clicks, className: "mono text-end" },
            { header: { label: "Conversions", className: "text-end" }, cell: (c) => c.conversions, className: "mono text-end" },
            { header: "Created", cell: (c) => c.created_at ? c.created_at.substring(0, 10) : "—", className: "mono small" },
          ]}
          data={referralCodes}
          empty="No referral codes issued"
          rowKey={(c) => c.code}
        />
      )}
    </div>
  );
}
