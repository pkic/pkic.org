import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { Checkbox } from "../../../../ui/Checkbox";
import { isApplicationTerminalStage } from "../../../../../shared/schemas/member-applications";
import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  membershipWorkflowReviewResponseSchema,
  membershipObjectionCreateResponseSchema,
  membershipWorkflowActionResponseSchema,
} from "../../../../../shared/schemas/membership-review-routes";
import {
  membershipWorkflowActionSchema,
  membershipWorkflowObjectionCreateSchema,
  membershipWorkflowObjectionResolveSchema,
  membershipWorkflowObjectionsResponseSchema,
  type membershipWorkflowObjectionSchema,
} from "../../../../../shared/schemas/membership-workflows";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { MembershipWorkflowProgress } from "../../../../components/MembershipWorkflowProgress";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { PageHeader } from "../../../../ui/PageHeader";
import { Select, Textarea } from "../../../../ui/TextControl";
import { ApplicationAnswersCard } from "./ApplicationAnswersCard";

type Review = z.infer<typeof membershipWorkflowReviewResponseSchema>;
type Objection = z.infer<typeof membershipWorkflowObjectionSchema>;
const resolutionLabels: Record<z.infer<typeof membershipWorkflowObjectionResolveSchema>["resolution"], string> = {
  withdrawn: "Withdraw my objection",
  resolved: "Resolved by evidence",
  upheld: "Upheld — still blocks approval",
  overruled: "Overruled with authority and reason",
};

function ReviewAction({ base, review, onSaved }: { base: string; review: Review; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const staff = review.capabilities.completeReview;
  const [recordFor, setRecordFor] = useState(!review.capabilities.object && review.capabilities.recordForReviewer);
  const [reviewer, setReviewer] = useState<PickedUser | null>(null);
  const form = useContractForm(staff ? membershipWorkflowActionSchema : membershipWorkflowObjectionCreateSchema, {
    expectedRevision: review.workflow.revision,
    reason,
    body,
    onBehalfOfUserId: recordFor ? (reviewer?.id ?? "") : undefined,
  });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy) return;
    setBusy(true);
    try {
      if (staff) await postJson(`${base}/reviews/completion`, checked.data, membershipWorkflowActionResponseSchema);
      else await postJson(`${base}/objections`, checked.data, membershipObjectionCreateResponseSchema);
      setReason("");
      setBody("");
      form.reset();
      await onSaved();
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  if (!staff && !review.capabilities.object && !review.capabilities.recordForReviewer) return null;
  return (
    <Panel>
      <PanelHeader title={staff ? "Complete staff review" : "Raise an objection"} />
      <PanelBody>
        <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => void submit(event)}>
          {!staff && review.capabilities.recordForReviewer && (
            <>
              {review.capabilities.object && (
                <Checkbox
                  checked={recordFor}
                  onChange={(event) => setRecordFor(event.currentTarget.checked)}
                  label="Record a response received outside the portal"
                />
              )}
              {recordFor && (
                <Field
                  label="Reviewer"
                  required
                  {...form.of("onBehalfOfUserId")}
                  help="Select the eligible user who raised this objection. Your identity is recorded separately."
                >
                  {(control) => (
                    <UserPicker
                      inputProps={{ ...control, name: "onBehalfOfUserId" }}
                      value={reviewer}
                      onChange={setReviewer}
                      endpoint={`${base}/reviews/users`}
                      emptyMessage="No eligible reviewers match this step's audience."
                    />
                  )}
                </Field>
              )}
            </>
          )}
          {!staff && (
            <Field label="Objection" {...form.of("body")} required>
              {(control) => (
                <Textarea
                  {...control}
                  name="body"
                  value={body}
                  onInput={(event) => setBody(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          <Field label={staff ? "Review decision and reason" : "Reason for recording"} {...form.of("reason")} required>
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                value={reason}
                onInput={(event) => setReason(event.currentTarget.value)}
              />
            )}
          </Field>
          <ErrorAlert error={error} />
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              {staff ? "Complete review" : "Record objection"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
function ResolveObjection({
  base,
  review,
  objection,
  onSaved,
  onCancel,
}: {
  base: string;
  review: Review;
  objection: Objection;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState<z.infer<typeof membershipWorkflowObjectionResolveSchema>["resolution"]>(
    objection.authorUserId === review.userId ? "withdrawn" : "resolved",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(membershipWorkflowObjectionResolveSchema, {
    expectedRevision: review.workflow.revision,
    reason,
    resolution,
  });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy) return;
    setBusy(true);
    try {
      await postJson(
        `${base}/objections/${objection.id}/resolution`,
        checked.data,
        membershipWorkflowActionResponseSchema,
      );
      await onSaved();
      onCancel();
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Resolve objection" />
      <PanelBody class="pk-stack">
        <p>{objection.body}</p>
        <form noValidate {...form.handlers} onSubmit={(event) => void submit(event)} class="pk-stack">
          <Field label="Resolution" {...form.of("resolution")}>
            {(control) => (
              <Select
                {...control}
                name="resolution"
                value={resolution}
                onChange={(event) =>
                  setResolution(
                    membershipWorkflowObjectionResolveSchema.shape.resolution.parse(event.currentTarget.value),
                  )
                }
              >
                {membershipWorkflowObjectionResolveSchema.shape.resolution.options
                  .filter((value) =>
                    value === "withdrawn"
                      ? objection.authorUserId === review.userId
                      : review.capabilities.resolveObjections,
                  )
                  .map((value) => (
                    <option key={value} value={value}>
                      {resolutionLabels[value]}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Evidence and reason" {...form.of("reason")} required>
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                value={reason}
                onInput={(event) => setReason(event.currentTarget.value)}
              />
            )}
          </Field>
          <ErrorAlert error={error} />
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={busy}>
              Record resolution
            </Button>
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
export function WorkflowReviewPage({
  applicationId,
  embedded = false,
  onSaved,
}: {
  applicationId: string;
  embedded?: boolean;
  onSaved?: () => Promise<void>;
}) {
  const base = `/api/v1/members/applications/${encodeURIComponent(applicationId)}`;
  const state = useData(
    () => getJson(`${base}/reviews/current`, membershipWorkflowReviewResponseSchema),
    [applicationId],
  );
  const table = useRef<ApiTableActions | null>(null);
  const [selected, setSelected] = useState<Objection | null>(null);
  async function refresh() {
    await state.reload();
    await table.current?.reload();
    await onSaved?.();
  }
  if (state.loading) return <Spinner label="Loading application review…" />;
  if (!state.data) return <ErrorAlert error={state.error} />;
  const review = state.data;
  return (
    <div class="pk pk-stack">
      {!embedded && (
        <PageHeader
          title={review.application.organizationName ?? review.application.applicantName}
          eyebrow="Membership application review"
        />
      )}
      <ErrorAlert error={state.error} />
      <p>
        Submitted by {review.application.applicantName} ({review.application.applicantEmail}).
      </p>
      <MembershipWorkflowProgress progress={review.workflow} />
      <ReviewAction key={review.workflow.revision} base={base} review={review} onSaved={refresh} />
      <ApplicationAnswersCard detail={review.application} />
      {selected && (
        <ResolveObjection
          key={selected.id}
          base={base}
          review={review}
          objection={selected}
          onSaved={refresh}
          onCancel={() => setSelected(null)}
        />
      )}
      <ApiDataTable
        caption="Review objections"
        endpoint={`${base}/objections`}
        responseSchema={membershipWorkflowObjectionsResponseSchema}
        resolve={(data) => data.objections}
        resolvePage={(data) => data.page}
        paginate
        initialSort="-createdAt"
        actionsRef={table}
        searchPlaceholder="Objection or resolution"
        columns={[
          {
            header: "Reviewer",
            cell: (objection) => (
              <span>
                {objection.authorLabel}
                {objection.recordedByUserId !== objection.authorUserId && objection.recordedByLabel
                  ? ` (recorded by ${objection.recordedByLabel})`
                  : ""}
              </span>
            ),
          },
          { header: "Objection", cell: (objection) => objection.body },
          { header: "State", cell: (objection) => objection.state },
          { header: "Resolution", cell: (objection) => objection.resolutionReason ?? "Awaiting resolution" },
        ]}
        rowKey={(objection) => objection.id}
        rowAction={(objection) =>
          !isApplicationTerminalStage(review.workflow.lifecycle) &&
          ["unresolved", "upheld"].includes(objection.state) &&
          (review.capabilities.resolveObjections || objection.authorUserId === review.userId)
            ? { label: "Resolve objection", onSelect: () => setSelected(objection) }
            : undefined
        }
      />
    </div>
  );
}
