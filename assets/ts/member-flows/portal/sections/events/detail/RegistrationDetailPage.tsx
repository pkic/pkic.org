import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../../components/Badge";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson, postJson } from "../../../../../shared/api-client";
import { fmt, toast } from "../../../ui";
import { useData } from "../../../../../hooks/useData";
import { FormAnswerTable } from "../../../../../components/forms/FormResponseViews";
import {
  eventRegistrationDetailResponseSchema,
  type EventRegistrationDetailResponse,
} from "../../../../../../shared/schemas/event-registration-detail";
import {
  eventRegistrationAccessResponseSchema,
  eventRegistrationBadgeRegenerationResponseSchema,
  eventRegistrationNotificationResponseSchema,
} from "../../../../../../shared/schemas/route-contracts-event-registration-management";
import {
  BadgeRolePanel,
  RegistrationAuditLogSection,
  RegistrationEmailEditor,
} from "./registration-detail/RegistrationPanels";
import { RegistrationActionCard } from "./registration-detail/RegistrationActionCard";
import { eventRegistrationPath, eventRegistrationResourcePath, eventRegistrationsViewPath } from "./registration-paths";

function attendanceTypeLabel(t: string): string {
  return { in_person: "In-person", virtual: "Virtual", on_demand: "On-demand" }[t] ?? t;
}

// ─── Day attendance table ─────────────────────────────────────────────────────

// ─── Main detail page ─────────────────────────────────────────────────────────

export function RegistrationDetailPage({ slug, regId }: { slug: string; regId: string }) {
  const [, navigate] = useHashLocation();
  const [resendStatus, setResendStatus] = useState("");
  const [openingManage, setOpeningManage] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const { data, loading, error, reload } = useData<EventRegistrationDetailResponse>(
    async () => getJson(eventRegistrationPath(slug, regId), eventRegistrationDetailResponseSchema),
    [slug, regId],
  );

  const reg = data?.registration;
  const form = data?.form ?? null;

  async function handleResend() {
    setResendStatus("Sending…");
    try {
      await postJson(
        eventRegistrationResourcePath(slug, regId, "notifications"),
        { type: "confirmation" },
        eventRegistrationNotificationResponseSchema,
      );
      toast("Confirmation email queued", "success");
      setResendStatus("✓ Queued");
    } catch (e) {
      const msg = (e as Error).message;
      setResendStatus(msg);
      toast(msg, "error");
    }
  }

  async function handleOpenManage() {
    setOpeningManage(true);
    try {
      const { manageUrl } = await postJson(
        eventRegistrationResourcePath(slug, regId, "access"),
        {},
        eventRegistrationAccessResponseSchema,
      );
      window.open(manageUrl, "_blank", "noopener");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setOpeningManage(false);
    }
  }

  async function handleRegenerateBadge() {
    setRegenerating(true);
    try {
      await postJson(
        eventRegistrationResourcePath(slug, regId, "badge"),
        {},
        eventRegistrationBadgeRegenerationResponseSchema,
      );
      toast("Badge regeneration queued", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!reg) return null;

  const shareUrl = reg.referral_code ? `${window.location.origin}/r/${reg.referral_code}` : null;
  const ogBadgeUrl = reg.referral_code
    ? `${window.location.origin}/api/v1/registrations/referrals/${reg.referral_code}/badge`
    : null;
  const name = reg.display_name ?? reg.user_email ?? "—";

  return (
    <div>
      {/* Back + header */}
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => navigate(eventRegistrationsViewPath(slug))}>
          ← Back
        </button>
        <h5 class="mb-0">{name}</h5>
        <Badge status={reg.status} />
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {/* Summary row */}
      <div class="row g-3 mb-3">
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Email</div>
            <RegistrationEmailEditor
              email={reg.user_email ?? "—"}
              slug={slug}
              regId={regId}
              isCancelled={reg.status === "cancelled"}
              onSaved={() => void reload()}
            />
          </div>
        </div>
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Attendance</div>
            <div>{reg.attendance_type ? attendanceTypeLabel(reg.attendance_type) : "—"}</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Source</div>
            <div>{reg.source_type ?? "—"}</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Registered</div>
            <div class="mono small">{fmt(reg.created_at)}</div>
          </div>
        </div>
      </div>

      {/* Linked form responses */}
      {(form || (reg.customAnswers && Object.keys(reg.customAnswers).length > 0)) && (
        <div class="card mb-3">
          <div class="card-header">
            <h6 class="mb-0">
              Registration Answers
              {form?.title && <span class="text-muted fw-normal ms-2">— {form.title}</span>}
            </h6>
          </div>
          <div class="card-body p-0">
            <FormAnswerTable answers={reg.customAnswers} fields={form?.fields} />
          </div>
        </div>
      )}

      {/* Actions row */}
      <div class="row g-3 mb-3">
        <RegistrationActionCard title="Manage" description="Opens the registrant-facing manage page in a new tab.">
          <button class="btn btn-sm btn-primary" onClick={() => void handleOpenManage()} disabled={openingManage}>
            {openingManage ? "Opening…" : "Open Manage Page ↗"}
          </button>
        </RegistrationActionCard>

        <RegistrationActionCard title="Confirmation Email" description="Rotates the token and re-queues the email.">
          <button class="btn btn-sm btn-outline-primary" onClick={() => void handleResend()}>
            Resend Email
          </button>
          {resendStatus && (
            <div class={`mt-2 small ${resendStatus.startsWith("✓") ? "text-success" : "text-danger"}`}>
              {resendStatus}
            </div>
          )}
        </RegistrationActionCard>

        <RegistrationActionCard title="Social Promo Kit">
          {shareUrl ? (
            <>
              <div class="mb-2">
                <label class="form-label small fw-semibold mb-1">Referral Link</label>
                <div class="input-group input-group-sm">
                  <input type="text" class="form-control form-control-sm mono" value={shareUrl} readOnly />
                  <button
                    class="btn btn-outline-secondary"
                    onClick={() => void navigator.clipboard.writeText(shareUrl)}
                    title="Copy link"
                  >
                    📋
                  </button>
                </div>
              </div>
              <div class="d-flex flex-wrap gap-1">
                <a href={ogBadgeUrl!} target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">
                  View Badge 📷
                </a>
                <button
                  class="btn btn-sm btn-outline-secondary"
                  onClick={() => void handleRegenerateBadge()}
                  disabled={regenerating}
                >
                  {regenerating ? "Regenerating…" : "Regenerate Badge 🔄"}
                </button>
              </div>
            </>
          ) : (
            <p class="small text-muted fst-italic mb-0">No referral code.</p>
          )}
        </RegistrationActionCard>
      </div>

      {/* Badge role */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Badge Role</h6>
        </div>
        <div class="card-body">
          <p class="small text-muted mb-2">Set the role shown on the attendee's promotional badge.</p>
          <BadgeRolePanel slug={slug} regId={regId} />
        </div>
      </div>

      {/* Audit log */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Audit Log</h6>
        </div>
        <div class="card-body">
          <RegistrationAuditLogSection slug={slug} regId={regId} />
        </div>
      </div>
    </div>
  );
}
