import { useState } from "preact/hooks";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { DataTable } from "../../../../ui/DataTable";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../../../ui/Content.css";
import {
  ecDecisionRecordSchema,
  type EcDecisionRecordInput,
  type MembershipApplicationDetail,
} from "../../../../../shared/schemas/membership-application-management";
import type { EcDecisionValue } from "../../../../../shared/schemas/ec-review";

/** The two decisions, in the words the reader sees rather than the stored value. */
const DECISION_LABEL: Record<EcDecisionValue, string> = {
  approve: "Approve",
  decline: "Decline",
};

/**
 * The Executive Committee's decisions on one application, and the staff
 * override that records one on a member's behalf.
 *
 * The decisions were an unnamed bulleted list of badges: four fields repeated
 * per row with no caption, so a reader arriving at it was told only "list".
 * They are now a captioned table beside the page's other tables.
 *
 * The override form used to have no labels at all — three placeholder strings,
 * which vanish the moment anything is typed — and it failed silently: an empty
 * user id returned from the submit handler saying nothing, and the reason the
 * backend requires for a decline was described only in a placeholder. Each
 * control now names itself through a Field, and the form is checked by the
 * decision contract the route parses, so both refusals are reported on the
 * control they belong to.
 */
export function ApplicationEcDecisionsCard({
  detail,
  canApprove,
  onRecordEcDecision,
}: {
  detail: MembershipApplicationDetail;
  canApprove: boolean;
  onRecordEcDecision: (params: EcDecisionRecordInput) => Promise<void>;
}) {
  const [ecMemberUserId, setEcMemberUserId] = useState("");
  const [ecDecision, setEcDecision] = useState<EcDecisionValue>("approve");
  const [ecReason, setEcReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(ecDecisionRecordSchema, {
    // The override exists to name the member, so a blank identifier is sent
    // as what was typed and refused by the contract here, rather than left
    // out and sent as the reader's own decision.
    ecMemberUserId: ecMemberUserId.trim(),
    decision: ecDecision,
    reason: ecReason.trim() ? ecReason : undefined,
  });

  async function submitEcDecision(event: Event) {
    event.preventDefault();
    // A loading Button stays focusable and therefore clickable, so the guard
    // against recording the same decision twice belongs here rather than on it.
    if (saving) return;
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    try {
      await onRecordEcDecision(checked.data);
      setEcMemberUserId("");
      setEcReason("");
      form.reset();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk">
      <Panel aria-label="EC decisions">
        <PanelHeader title="EC decisions" />
        <PanelBody class="pk-stack">
          <DataTable
            caption="Executive Committee decisions on this application"
            rows={detail.ecDecisions}
            rowKey={(record) => record.id}
            empty="No Executive Committee decision has been recorded on this application yet."
            columns={[
              {
                id: "decision",
                header: "Decision",
                // The badge's tone repeats what the word already says.
                cell: (record) => <Badge status={record.decision} />,
                cellClass: "pk-nowrap",
              },
              { id: "reason", header: "Reason", cell: (record) => record.reason ?? "—" },
              {
                id: "ecMember",
                header: "EC member",
                cell: (record) => record.ecMemberUserId,
                cellClass: "pk-mono pk-small pk-break",
              },
              {
                id: "recorded",
                header: "Recorded",
                cell: (record) => fmt(record.createdAt),
                cellClass: "pk-mono pk-small pk-nowrap",
              },
            ]}
          />

          {canApprove && (
            <form
              noValidate
              class="pk-stack pk-stack--snug"
              {...form.handlers}
              onSubmit={(event) => void submitEcDecision(event)}
            >
              <h4>Record on behalf of an EC member</h4>
              <p class="pk-small">A staff override. The decision is attributed to the member you name.</p>
              <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={saving}>
                <Field label="EC member user ID" required {...form.of("ecMemberUserId")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="ecMemberUserId"
                      value={ecMemberUserId}
                      onInput={(event) => setEcMemberUserId((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Decision" required {...form.of("decision")}>
                  {(control) => (
                    <Select
                      {...control}
                      name="decision"
                      value={ecDecision}
                      onChange={(event) => setEcDecision((event.target as HTMLSelectElement).value as EcDecisionValue)}
                    >
                      <option value="approve">{DECISION_LABEL.approve}</option>
                      <option value="decline">{DECISION_LABEL.decline}</option>
                    </Select>
                  )}
                </Field>
                <Field
                  label="Reason"
                  required={ecDecision === "decline"}
                  help="Required when declining."
                  {...form.of("reason")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="reason"
                      value={ecReason}
                      onInput={(event) => setEcReason((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </fieldset>
              {error && <Alert tone="danger">{error}</Alert>}
              <div class="pk-cluster">
                <Button type="submit" variant="primary" size="sm" loading={saving}>
                  {saving ? "Recording…" : "Record"}
                </Button>
              </div>
            </form>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
