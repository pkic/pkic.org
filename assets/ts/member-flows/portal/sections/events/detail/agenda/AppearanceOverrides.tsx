import { useState, useRef } from "preact/hooks";
import type { z } from "zod";
import {
  appearanceOverrideRequestSchema,
  appearanceOverrideReviewSchema,
  appearanceOverridesResponseSchema,
  appearanceOverrideSchema,
  appearanceOverrideReviewResponseSchema,
} from "../../../../../../../shared/schemas/event-appearance-overrides";
import type { SessionAppearance } from "../../../../../../../shared/schemas/event-session-history";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { Select, Textarea } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
type Override = z.infer<typeof appearanceOverrideSchema>;
export function AppearanceOverrides({
  canRequest = true,
  snapshot,
  occurrenceId,
  appearances,
  onSaved,
}: {
  canRequest?: boolean;
  snapshot: AgendaSnapshot;
  occurrenceId: string;
  appearances: SessionAppearance[];
  onSaved: (s: AgendaSnapshot) => void;
}) {
  const [requesting, setRequesting] = useState(false),
    [userId, setUserId] = useState(appearances[0]?.userId ?? ""),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Override | null>(null),
    [decision, setDecision] = useState<"approved" | "rejected">("approved"),
    [reviewReason, setReviewReason] = useState(""),
    [canReview, setCanReview] = useState(false);
  const actions = useRef<ApiTableActions | null>(null),
    appearance = appearances.find((a) => a.userId === userId);
  const form = useContractForm(appearanceOverrideRequestSchema, {
    expectedRevision: snapshot.revision,
    appearance,
    reason,
    evidence,
  });
  const reviewForm = useContractForm(appearanceOverrideReviewSchema, {
    expectedRevision: snapshot.revision,
    decision,
    reason: reviewReason,
  });
  const endpoint = `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/appearance-overrides`;
  async function request() {
    if (!canRequest) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      await postJson(endpoint, checked.data, appearanceOverrideSchema);
      setRequesting(false);
      setReason("");
      setEvidence("");
      setError("");
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    if (!selected) return;
    const checked = reviewForm.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      const response = await postJson(
        `${endpoint}/${selected.id}/decisions`,
        checked.data,
        appearanceOverrideReviewResponseSchema,
      );
      onSaved(response.agenda);
      setSelected(null);
      setError("");
    } catch (e) {
      setError(reviewForm.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  if (requesting || selected)
    return (
      <section class="pk-stack" aria-label="Historical representation overrides">
        <h3>{selected ? "Review historical representation" : "Request historical representation review"}</h3>
        <Button
          disabled={busy}
          onClick={() => {
            setRequesting(false);
            setSelected(null);
            setError("");
          }}
        >
          Back to historical representation decisions
        </Button>
        {error && <ErrorAlert error={error} />}
        {requesting && (
          <form
            noValidate
            {...form.handlers}
            class="pk-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void request();
            }}
          >
            <Field label="Person to represent" {...form.of("appearance")}>
              {(control) => (
                <Select
                  {...control}
                  name="appearance"
                  value={userId}
                  onChange={(e) => setUserId(e.currentTarget.value)}
                >
                  {appearances.map((a) => (
                    <option value={a.userId}>{a.displayName}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Override reason" {...form.of("reason")}>
              {(control) => (
                <Textarea {...control} name="reason" value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
              )}
            </Field>
            <Field label="Historical evidence" {...form.of("evidence")}>
              {(control) => (
                <Textarea
                  {...control}
                  name="evidence"
                  value={evidence}
                  onInput={(e) => setEvidence(e.currentTarget.value)}
                />
              )}
            </Field>
            <Button type="submit" disabled={busy || !appearance}>
              Request independent review
            </Button>
          </form>
        )}
        {selected && (
          <form
            noValidate
            {...reviewForm.handlers}
            class="pk-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void review();
            }}
          >
            <p>
              Requested by {selected.requestedBy}: {selected.appearance.displayName}, {selected.appearance.jobTitle},{" "}
              {selected.appearance.organizationName}. {selected.reason}
            </p>
            <Field label="Decision" {...reviewForm.of("decision")}>
              {(control) => (
                <Select
                  {...control}
                  name="decision"
                  value={decision}
                  onChange={(e) =>
                    setDecision(appearanceOverrideReviewSchema.shape.decision.parse(e.currentTarget.value))
                  }
                >
                  {appearanceOverrideReviewSchema.shape.decision.options.map((value) => (
                    <option value={value}>{value}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Review reason" {...reviewForm.of("reason")}>
              {(control) => (
                <Textarea
                  {...control}
                  name="reason"
                  value={reviewReason}
                  onInput={(e) => setReviewReason(e.currentTarget.value)}
                />
              )}
            </Field>
            <div class="pk-cluster">
              <Button onClick={() => setSelected(null)}>Cancel review</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Record decision
              </Button>
            </div>
          </form>
        )}
      </section>
    );
  return (
    <section class="pk-stack" aria-label="Historical representation overrides">
      <h3>Historical representation overrides</h3>
      {canRequest ? (
        <p>
          Edit the proposed appearance in archive details, then record the reason and source evidence here. A different
          authorized reviewer must approve it. Canonical person and identity dates remain unchanged, and approval
          updates only the draft.
        </p>
      ) : (
        <p>
          Review the requested historical representation and its source evidence. Decisions update the draft; agenda
          publication requires separate approval.
        </p>
      )}
      {error && <ErrorAlert error={error} />}

      <ApiDataTable<Override, z.infer<typeof appearanceOverridesResponseSchema>>
        createAction={
          canRequest
            ? {
                label: "Request historical representation review",
                onSelect: () => {
                  setError("");
                  setRequesting(true);
                },
              }
            : undefined
        }
        caption="Historical representation decisions"
        endpoint={endpoint}
        responseSchema={appearanceOverridesResponseSchema}
        resolve={(response) => {
          setCanReview(response.canReview);
          return response.overrides;
        }}
        resolvePage={(response) => response.page}
        paginate
        initialSort="-requestedAt"
        actionsRef={actions}
        rowKey={(row) => row.id}
        columns={[
          {
            header: "Representation",
            cell: (row) => `${row.appearance.displayName} · ${row.appearance.organizationName ?? ""}`,
          },
          {
            header: "Reason and evidence",
            cell: (row) => (
              <span>
                {row.reason}
                <br />
                {row.evidence}
              </span>
            ),
          },
          {
            header: "Decision",
            cell: (row) => (
              <span>
                {row.decision ?? "Pending review"}
                {row.reviewReason && <small>{row.reviewReason}</small>}
              </span>
            ),
          },
          {
            header: "Review",
            cell: (row) =>
              canReview && !row.decision ? <Button onClick={() => setSelected(row)}>Review override</Button> : null,
          },
        ]}
      />
    </section>
  );
}
