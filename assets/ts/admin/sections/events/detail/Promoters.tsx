import { h } from "preact";
import { useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { api } from "../../../api";
import { fmtMoney } from "../../../charts";
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
  invite_conversion_rate: number;
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

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function Promoters({ slug }: { slug: string }) {
  const { data, loading, error } = useData<PromotersResponse>(
    () => api<PromotersResponse>(`/api/v1/admin/events/${slug}/promoters`), [slug],
  );
  const [tab, setTab] = useState<"promoters" | "codes">("promoters");

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { promoters, referralCodes } = data;

  return (
    <div>
      <ul class="nav nav-tabs mb-3">
        <li class="nav-item">
          <button class={`nav-link${tab === "promoters" ? " active" : ""}`} onClick={() => setTab("promoters")}>
            Top Promoters ({promoters.length})
          </button>
        </li>
        <li class="nav-item">
          <button class={`nav-link${tab === "codes" ? " active" : ""}`} onClick={() => setTab("codes")}>
            Referral Codes ({referralCodes.length})
          </button>
        </li>
      </ul>

      {tab === "promoters" && (
        <div class="table-responsive">
          <table class="table table-sm table-hover">
            <thead>
              <tr>
                <th>#</th>
                <th>Promoter</th>
                <th>Sent</th>
                <th>Accepted</th>
                <th>Conversion</th>
                <th>Clicks</th>
                <th>Conversions</th>
                <th>Impact Score</th>
              </tr>
            </thead>
            <tbody>
              {promoters.slice(0, 100).map((p, i) => {
                const rank = i + 1;
                const medal = MEDALS[rank] ?? "";
                const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
                return (
                  <tr key={p.user_id}>
                    <td class="mono">{medal} {rank}</td>
                    <td>
                      <strong class="adm-cell-name">{name}</strong>
                      {name !== p.email && <><br /><span class="text-muted small">{p.email}</span></>}
                    </td>
                    <td class="mono">{p.invites_sent}</td>
                    <td class="mono">{p.invites_accepted}</td>
                    <td class="mono">{(p.invite_conversion_rate * 100).toFixed(0)}%</td>
                    <td class="mono">{p.referral_clicks}</td>
                    <td class="mono">{p.referral_conversions}</td>
                    <td class="mono fw-semibold">{p.impact_score.toFixed(1)}</td>
                  </tr>
                );
              })}
              {promoters.length === 0 && (
                <tr><td colSpan={8} class="text-center text-muted fst-italic py-3">No promoter activity yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "codes" && (
        <div class="table-responsive">
          <table class="table table-sm table-hover">
            <thead>
              <tr>
                <th>Code</th>
                <th>Owner</th>
                <th>Clicks</th>
                <th>Conversions</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {referralCodes.map((c) => (
                <tr key={c.code}>
                  <td class="mono">{c.code}</td>
                  <td>{c.user_email}</td>
                  <td class="mono">{c.clicks}</td>
                  <td class="mono">{c.conversions}</td>
                  <td class="mono small">{c.created_at ? c.created_at.substring(0, 10) : "—"}</td>
                </tr>
              ))}
              {referralCodes.length === 0 && (
                <tr><td colSpan={5} class="text-center text-muted fst-italic py-3">No referral codes issued</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
