import { useState } from "preact/hooks";
import { usePortalHashLocation } from "../../../hash-location";
import { Badge } from "../../../../../components/Badge";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson, postJson } from "../../../../../shared/api-client";
import { fmt, toast } from "../../../ui";
import { useData } from "../../../../../hooks/useData";
import { FormAnswerTable } from "../../../../../components/forms/FormResponseViews";
import { Alert } from "../../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { TextInput } from "../../../../../ui/TextControl";
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
import { attendanceTypeLabel } from "../attendance";
import { eventRegistrationPath, eventRegistrationResourcePath, eventRegistrationsViewPath } from "./registration-paths";
import "../../../../../ui/Content.css";

/**
 * The outcome of a background action, as the reader sees it.
 *
 * The Bootstrap surface told a queued email and a rejected one apart with
 * `text-success` and `text-danger` on the same span, so the two outcomes
 * differed only by hue. An Alert carries the tone and the role together —
 * `status` for a success, `alert` for a failure — and the sentence says which
 * happened without anyone having to decode a colour.
 */
interface ActionOutcome {
  tone: "ok" | "danger";
  message: string;
}

export function RegistrationDetailPage({ slug, regId, onBack }: { slug: string; regId: string; onBack?: () => void }) {
  const [, navigate] = usePortalHashLocation();
  const [resending, setResending] = useState(false);
  const [resendOutcome, setResendOutcome] = useState<ActionOutcome | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [openingManage, setOpeningManage] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const { data, loading, error, reload } = useData<EventRegistrationDetailResponse>(
    async () => getJson(eventRegistrationPath(slug, regId), eventRegistrationDetailResponseSchema),
    [slug, regId],
  );

  const reg = data?.registration;
  const form = data?.form ?? null;

  async function handleResend(): Promise<void> {
    setResending(true);
    setResendOutcome(null);
    try {
      await postJson(
        eventRegistrationResourcePath(slug, regId, "notifications"),
        { type: "confirmation" },
        eventRegistrationNotificationResponseSchema,
      );
      toast("Confirmation email queued", "success");
      setResendOutcome({ tone: "ok", message: "Confirmation email queued." });
    } catch (e) {
      const message = (e as Error).message;
      setResendOutcome({ tone: "danger", message });
      toast(message, "error");
    } finally {
      setResending(false);
    }
  }

  async function handleOpenManage(): Promise<void> {
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

  async function handleRegenerateBadge(): Promise<void> {
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

  /*
   * Copying can be refused — an insecure origin, a browser that withholds the
   * clipboard, a denied permission — and the old surface fired and forgot, so
   * a refusal looked exactly like a success. Both endings are announced, and
   * the failure says what to do instead.
   */
  async function handleCopyReferralLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("Referral link copied to the clipboard.");
    } catch {
      setCopyStatus("Could not copy the referral link. Select the field above and copy it manually.");
    }
  }

  if (loading) return <Spinner label="Loading this registration…" />;
  if (error) return <ErrorAlert error={error} />;
  if (!reg) return null;

  const shareUrl = reg.referral_code ? `${window.location.origin}/r/${reg.referral_code}` : null;
  const ogBadgeUrl = reg.referral_code
    ? `${window.location.origin}/api/v1/registrations/referrals/${reg.referral_code}/badge`
    : null;
  const name = reg.display_name ?? reg.user_email ?? "This registration";
  const answersTitle = form?.title ? `Registration answers — ${form.title}` : "Registration answers";

  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button size="sm" onClick={() => (onBack ? onBack() : navigate(eventRegistrationsViewPath(slug)))}>
          ← Back
        </Button>
        <h2>{name}</h2>
        <Badge status={reg.status} />
        <Button size="sm" class="pk-push" onClick={() => void reload()}>
          ↺ Refresh
        </Button>
      </div>

      <Panel>
        <PanelHeader title="Registration summary" />
        <PanelBody>
          <dl class="pk-datalist pk-small">
            <dt>Email</dt>
            <dd>
              <RegistrationEmailEditor
                email={reg.user_email ?? "Not recorded"}
                slug={slug}
                regId={regId}
                isCancelled={reg.status === "cancelled"}
                onSaved={() => void reload()}
              />
            </dd>
            <dt>Attendance</dt>
            <dd>{attendanceTypeLabel(reg.attendance_type)}</dd>
            <dt>Source</dt>
            <dd>{reg.source_type}</dd>
            <dt>Registered</dt>
            <dd class="pk-mono">{fmt(reg.created_at)}</dd>
          </dl>
        </PanelBody>
      </Panel>

      {(form || (reg.customAnswers && Object.keys(reg.customAnswers).length > 0)) && (
        <Panel>
          <PanelHeader title={answersTitle} />
          <PanelBody>
            <FormAnswerTable answers={reg.customAnswers} fields={form?.fields} />
          </PanelBody>
        </Panel>
      )}

      <div class="pk-grid pk-grid--roomy">
        <Panel>
          <PanelHeader title="Manage" />
          <PanelBody class="pk-stack pk-stack--snug">
            <p class="pk-small">Opens the registrant-facing manage page in a new tab.</p>
            <div class="pk-cluster">
              <Button size="sm" variant="primary" loading={openingManage} onClick={() => void handleOpenManage()}>
                {openingManage ? "Opening…" : "Open manage page ↗"}
              </Button>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Confirmation email" />
          <PanelBody class="pk-stack pk-stack--snug">
            <p class="pk-small">Rotates the token and re-queues the email.</p>
            <div class="pk-cluster">
              <Button size="sm" loading={resending} onClick={() => void handleResend()}>
                {resending ? "Sending…" : "Resend email"}
              </Button>
            </div>
            {resendOutcome && <Alert tone={resendOutcome.tone}>{resendOutcome.message}</Alert>}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Social promo kit" />
          <PanelBody class="pk-stack pk-stack--snug">
            {shareUrl && ogBadgeUrl ? (
              <>
                <Field label="Referral link" help="Share this link so registrations are credited to this attendee.">
                  {(control) => <TextInput {...control} class="pk-mono" value={shareUrl} readOnly />}
                </Field>
                <div class="pk-cluster">
                  <Button size="sm" onClick={() => void handleCopyReferralLink(shareUrl)}>
                    Copy link
                  </Button>
                  <ButtonLink size="sm" href={ogBadgeUrl} target="_blank" rel="noopener">
                    View badge ↗
                  </ButtonLink>
                  <Button size="sm" loading={regenerating} onClick={() => void handleRegenerateBadge()}>
                    {regenerating ? "Regenerating…" : "Regenerate badge"}
                  </Button>
                </div>
                <p class="pk-small" role="status">
                  {copyStatus}
                </p>
              </>
            ) : (
              <p class="pk-small">This registration has no referral code, so there is no promo kit to share.</p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Badge role" />
        <PanelBody class="pk-stack pk-stack--snug">
          <p class="pk-small">Set the role shown on the attendee's promotional badge.</p>
          <BadgeRolePanel slug={slug} regId={regId} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Audit log" />
        <PanelBody>
          <RegistrationAuditLogSection slug={slug} regId={regId} />
        </PanelBody>
      </Panel>
    </div>
  );
}
