import { useEffect, useState } from "preact/hooks";
import {
  EVIDENCE_RETENTION_PURPOSES,
  EVIDENCE_RETENTION_HOLD_REASONS,
  eventEvidenceRetentionPolicyUpdateSchema,
  eventEvidenceRetentionPolicyResponseSchema,
  eventEvidenceRetentionPolicyMutationResponseSchema,
  type EventEvidenceRetentionPolicyResponse,
} from "../../../../../../../shared/schemas/event-evidence-retention";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { getJson, putJson } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { EditActions } from "../../../../../../ui/EditActions";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { Alert } from "../../../../../../ui/Alert";
import { Badge } from "../../../../../../ui/Badge";
import { FormSection } from "../../../../../../ui/FormSection";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { portalSession } from "../../../../state";
import { portalHasGlobalPermission } from "../../../../shell/portal-navigation";
import type { EventDetail } from "../../types";
import type { GroupEvent } from "../../../../../../../shared/schemas/group-events";
import { EvidenceRemoval } from "./EvidenceRemoval";

type RetentionEvent = Pick<EventDetail | GroupEvent, "id" | "timezone" | "capabilities">;
export function RawEvidenceRetentionPolicy({ event }: { event: RetentionEvent }) {
  const session = portalSession.value;
  const canRead =
    !!session && portalHasGlobalPermission(session, "retention:read") && event.capabilities.includes("manage");
  const canWrite = !!session && portalHasGlobalPermission(session, "retention:run");
  const canRemove = canWrite && !!session && portalHasGlobalPermission(session, "users:anonymize");
  return canRead ? (
    <div class="pk-stack">
      <PolicyForm event={event} canWrite={canWrite} />
      <EvidenceRemoval eventId={event.id} canRemove={canRemove} />
    </div>
  ) : null;
}
function PolicyForm({ event, canWrite }: { event: RetentionEvent; canWrite: boolean }) {
  const endpoint = `/api/v1/retention/events/${encodeURIComponent(event.id)}/policy`;
  const [messageTone, setMessageTone] = useState<"ok" | "danger">("danger");
  const [policy, setPolicy] = useState<EventEvidenceRetentionPolicyResponse | null>(null);
  const [cutoff, setCutoff] = useState("");
  const [purpose, setPurpose] = useState("");
  const [hold, setHold] = useState(false);
  const [reason, setReason] = useState("");
  const [operationId, setOperationId] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    getJson(endpoint, eventEvidenceRetentionPolicyResponseSchema)
      .then((response) => {
        if (!active) return;
        setPolicy(response);
        setCutoff(
          response.policy.evidenceUntil ? instantToDateTimeLocal(response.policy.evidenceUntil, event.timezone) : "",
        );
        setPurpose(response.policy.purposeCode ?? "");
        setHold(response.policy.legalHold);
        setReason(response.policy.holdReasonCode ?? "");
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Policy unavailable.");
      });
    return () => {
      active = false;
    };
  }, [endpoint, event.timezone]);
  let evidenceUntil: string | null = null;
  if (cutoff) {
    try {
      evidenceUntil = dateTimeLocalToIso(cutoff, event.timezone);
    } catch {
      evidenceUntil = cutoff;
    }
  }
  const form = useContractForm(eventEvidenceRetentionPolicyUpdateSchema, {
    evidenceUntil,
    purposeCode: purpose.trim() || null,
    legalHold: hold,
    holdReasonCode: reason.trim() || null,
    expectedRevision: policy?.revision ?? 0,
    operationId,
  });
  async function save(e: Event) {
    e.preventDefault();
    if (!canWrite || !policy || !editing || saving) return;
    setMessageTone("danger");
    const checked = form.submit();
    if (!checked.data) {
      setMessage(checked.formMessage);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await putJson(endpoint, checked.data, eventEvidenceRetentionPolicyMutationResponseSchema);
      setPolicy({ ...policy, revision: result.revision, policy: result.policy });
      setOperationId("");
      setEditing(false);
      setMessageTone("ok");
      setMessage("Raw evidence policy saved.");
    } catch (error: unknown) {
      form.refuse(error);
      setMessage(error instanceof Error ? error.message : "Policy could not be saved. Your draft is preserved.");
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    if (!policy) return;
    setCutoff(policy.policy.evidenceUntil ? instantToDateTimeLocal(policy.policy.evidenceUntil, event.timezone) : "");
    setPurpose(policy.policy.purposeCode ?? "");
    setHold(policy.policy.legalHold);
    setReason(policy.policy.holdReasonCode ?? "");
    setEditing(false);
    setOperationId("");
    setMessage(null);
    form.reset();
  }
  function edit() {
    if (!canWrite || !policy) return;
    if (!globalThis.isSecureContext || typeof globalThis.crypto?.randomUUID !== "function") {
      setMessageTone("danger");
      setMessage(
        "Editing raw evidence retention requires a secure connection with browser support for secure operation IDs.",
      );
      return;
    }
    cancel();
    setOperationId(globalThis.crypto.randomUUID());
    setEditing(true);
  }
  const panel = (
    <Panel>
      <PanelHeader title="Raw evidence retention">
        <Badge tone={!policy || policy.revision === 0 ? "neutral" : policy.policy.legalHold ? "warn" : "info"}>
          {!policy
            ? "Loading"
            : policy.revision === 0
              ? "Not configured"
              : policy.policy.legalHold
                ? "Removal paused"
                : "Policy configured"}
        </Badge>
        {policy && canWrite && (
          <EditActions
            label="Raw evidence retention actions"
            editing={editing}
            saving={saving}
            onEdit={edit}
            onCancel={cancel}
            saveLabel="Save raw evidence policy"
          />
        )}
      </PanelHeader>
      <PanelBody>
        <p>
          Contact access expiry is separate from attendance and scan evidence. Choose how long to retain this evidence
          and why. Pause evidence removal while a review or investigation needs it.
        </p>
        {!policy ? (
          <Alert tone={message ? "danger" : "info"}>{message ?? "Loading raw evidence policy…"}</Alert>
        ) : !editing ? (
          <DescriptionList
            items={[
              {
                term: `Retain evidence until (${event.timezone})`,
                value: policy.policy.evidenceUntil
                  ? formatDateTimeInZone(policy.policy.evidenceUntil, event.timezone)
                  : "Not configured",
              },
              {
                term: "Retention purpose",
                value: policy.policy.purposeCode
                  ? EVIDENCE_RETENTION_PURPOSES[policy.policy.purposeCode]
                  : "Not configured",
              },
              { term: "Evidence removal", value: policy.policy.legalHold ? "Paused" : "Not paused" },
              {
                term: "Reason for pause",
                value: policy.policy.holdReasonCode
                  ? EVIDENCE_RETENTION_HOLD_REASONS[policy.policy.holdReasonCode]
                  : "None",
              },
            ]}
          />
        ) : (
          <div>
            <p>
              {policy.revision === 0 ? "No raw evidence policy is configured." : `Policy revision ${policy.revision}.`}{" "}
              Times are shown in {event.timezone} and stored in UTC.
            </p>
            <fieldset disabled={!canWrite || saving} class="pk-fieldset pk-stack">
              <FormSection title="Retention deadline and purpose">
                <Field {...form.of("evidenceUntil")} label={`Retain evidence until (${event.timezone})`}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="evidenceUntil"
                      type="datetime-local"
                      value={cutoff}
                      onInput={(e) => setCutoff(e.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field {...form.of("purposeCode")} label="Why retain this evidence?">
                  {(control) => (
                    <Select
                      {...control}
                      name="purposeCode"
                      value={purpose}
                      onChange={(e) => setPurpose(e.currentTarget.value)}
                    >
                      <option value="">Choose a purpose</option>
                      {Object.entries(EVIDENCE_RETENTION_PURPOSES).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </FormSection>
              <FormSection title="Preserve evidence for a review">
                <Checkbox
                  label="Pause evidence removal"
                  name="legalHold"
                  checked={hold}
                  onChange={(e) => {
                    setHold(e.currentTarget.checked);
                    if (!e.currentTarget.checked) setReason("");
                  }}
                />
                <Field {...form.of("holdReasonCode")} label="Why pause evidence removal?">
                  {(control) => (
                    <Select
                      {...control}
                      name="holdReasonCode"
                      value={reason}
                      disabled={!hold}
                      onChange={(e) => setReason(e.currentTarget.value)}
                    >
                      <option value="">Choose a reason</option>
                      {Object.entries(EVIDENCE_RETENTION_HOLD_REASONS).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </FormSection>
            </fieldset>
          </div>
        )}
        {policy && message && <Alert tone={messageTone}>{message}</Alert>}
      </PanelBody>
    </Panel>
  );
  return editing ? (
    <form noValidate {...form.handlers} onSubmit={save}>
      {panel}
    </form>
  ) : (
    panel
  );
}
