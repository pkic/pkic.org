import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type { AdminEventDay } from "../../../types";
import { useData } from "../../../../hooks/useData";
import { FormAnswerTable } from "./FormResponses";
import {
  adminRegistrationDetailResponseSchema,
  type AdminRegistrationDetailResponse,
} from "../../../../../shared/schemas/admin-registration-detail";
import { DayAttendancePanel } from "./registration-detail/DayAttendancePanel";
import {
  BadgeRolePanel,
  RegistrationAuditLogSection,
  RegistrationEmailEditor,
  RegistrationForceStatusPanel,
} from "./registration-detail/RegistrationPanels";

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

  const { data, loading, error, reload } = useData<AdminRegistrationDetailResponse>(
    async () =>
      adminRegistrationDetailResponseSchema.parse(
        await api<unknown>(`/api/v1/admin/events/${slug}/registrations/${regId}`),
      ),
    [slug, regId],
  );

  const { data: daysData } = useData<{ days: AdminEventDay[] }>(
    () => api<{ days: AdminEventDay[] }>(`/api/v1/admin/events/${slug}/days`),
    [slug],
  );

  const reg = data?.registration;
  const form = data?.form ?? null;
  const dayAttendance = data?.dayAttendance ?? [];
  const dayWaitlist = data?.dayWaitlist ?? [];
  const eventDays = daysData?.days ?? [];

  async function handleResend() {
    setResendStatus("Sending…");
    try {
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}/resend-confirmation`, {
        method: "POST",
        body: "{}",
      });
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
      const { manageUrl } = await api<{ manageUrl: string }>(
        `/api/v1/admin/events/${slug}/registrations/${regId}/open-manage`,
        { method: "POST", body: "{}" },
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
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}/regenerate-badge`, { method: "POST", body: "{}" });
      toast("Badge regenerated", "success");
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
  const ogBadgeUrl = reg.referral_code ? `${window.location.origin}/api/v1/og/${reg.referral_code}` : null;
  const name = reg.display_name ?? reg.user_email ?? "—";

  return (
    <div>
      {/* Back + header */}
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/events/${slug}/registrations`)}>
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

      {/* Day attendance */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Day Attendance and Waitlist</h6>
        </div>
        <div class="card-body">
          <DayAttendancePanel
            dayAttendance={dayAttendance}
            dayWaitlist={dayWaitlist}
            eventDays={eventDays}
            registrationStatus={reg.status}
            slug={slug}
            regId={regId}
            onReload={() => void reload()}
          />
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
        {/* Manage */}
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h6 class="mb-0">Manage</h6>
            </div>
            <div class="card-body">
              <p class="small text-muted mb-2">Opens the registrant-facing manage page in a new tab.</p>
              <button class="btn btn-sm btn-primary" onClick={() => void handleOpenManage()} disabled={openingManage}>
                {openingManage ? "Opening…" : "Open Manage Page ↗"}
              </button>
              {reg.status === "waitlisted" && (
                <div class="alert alert-warning mb-0 mt-2 small">
                  <strong>Waitlisted:</strong> does not yet have a confirmed in-person seat.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Resend */}
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h6 class="mb-0">Confirmation Email</h6>
            </div>
            <div class="card-body">
              <p class="small text-muted mb-2">Rotates the token and re-queues the email.</p>
              <button class="btn btn-sm btn-outline-primary" onClick={() => void handleResend()}>
                Resend Email
              </button>
              {resendStatus && (
                <div class={`mt-2 small ${resendStatus.startsWith("✓") ? "text-success" : "text-danger"}`}>
                  {resendStatus}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Social promo */}
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h6 class="mb-0">Social Promo Kit</h6>
            </div>
            <div class="card-body">
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
            </div>
          </div>
        </div>
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

      {/* Force status */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Override Status</h6>
        </div>
        <div class="card-body">
          <RegistrationForceStatusPanel
            currentStatus={reg.status}
            slug={slug}
            regId={regId}
            onSaved={() => void reload()}
          />
        </div>
      </div>
    </div>
  );
}
