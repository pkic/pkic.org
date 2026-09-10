import { useEffect, useState } from "preact/hooks";
import {
  memberUpdateResponseSchema,
  memberUpdateSchema,
  staffMembersListResponseSchema,
  type StaffMemberSummary,
} from "../../../../../shared/schemas/members-directory";
import {
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  MEMBER_STATUSES,
  type MembershipCategoryCatalogEntry,
} from "../../../../../shared/schemas/membership-categories";
import { statusLabel } from "../../../../components/Badge";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useContractForm } from "../../../../hooks/useContractForm";
import { getJson, patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select } from "../../../../ui/TextControl";
import { toast } from "../../ui";

/**
 * Changing what a membership is held under, and whether it still stands.
 *
 * The subject is the membership itself rather than one identity acting under
 * it: an organization's representatives inherit both, so changing either
 * through one of them is refused and belongs here.
 *
 * The categories offered are the ones the membership's kind can hold. An
 * organization cannot take an individual code, nor an individual an org-tied
 * one; the server refuses the mismatch, and the form does not offer it.
 */
export function MemberEditForm({
  memberId,
  categories,
  onSaved,
  onCancel,
}: {
  memberId: string;
  categories: readonly MembershipCategoryCatalogEntry[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [member, setMember] = useState<StaffMemberSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [membershipCategory, setMembershipCategory] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /*
   * The row is read back from the list narrowed to one membership, rather
   * than from a record endpoint: `/api/v1/members/:id` is the public member
   * profile, which carries none of the standing this page edits.
   */
  useEffect(() => {
    let cancelled = false;
    void getJson(
      `/api/v1/members?view=staff&limit=1&offset=0&memberId=${encodeURIComponent(memberId)}`,
      staffMembersListResponseSchema,
    )
      .then((page) => {
        if (cancelled) return;
        const found = page.members.find((candidate) => candidate.id === memberId) ?? null;
        if (!found) {
          setLoadError("That membership could not be found.");
          return;
        }
        setMember(found);
        setMembershipCategory(found.membershipCategory);
        setStatus(found.status);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError((cause as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  // One basis for validation: the same contract the route parses.
  const form = useContractForm(memberUpdateSchema, { membershipCategory, status });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      await patchJson(`/api/v1/members/${encodeURIComponent(memberId)}`, checked.data, memberUpdateResponseSchema);
      toast("Membership updated", "success");
      onSaved();
    } catch (caught) {
      // A server refusal names its fields the way the contract does.
      const message = form.refuse(caught);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const offered = categories.filter(
    (entry) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(entry.code) === (member?.memberType === "individual"),
  );

  return (
    <div class="pk pk-stack">
      {/* The page's way back: the edit has its own address, so leaving it is
          navigation rather than the disappearance of a layer. */}
      <div class="pk-cluster">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          ← All members
        </Button>
      </div>
      <Panel aria-label="Edit membership">
        <PanelHeader title={member ? `${member.name}'s membership` : "Edit membership"} headingLevel={2} />
        <PanelBody>
          {loadError && <Alert tone="danger">{friendlyErrorMessage(loadError)}</Alert>}
          {!member && !loadError && <Spinner />}
          {member && (
            <form noValidate class="pk-form" {...form.handlers} onSubmit={(event) => void submit(event)}>
              <fieldset class="pk-fieldset pk-field" disabled={busy}>
                <div class="pk-stack pk-stack--snug">
                  <Field label="Category" required {...form.of("membershipCategory")}>
                    {(control) => (
                      <Select
                        {...control}
                        value={membershipCategory}
                        onChange={(event) => setMembershipCategory((event.target as HTMLSelectElement).value)}
                      >
                        {offered.map((entry) => (
                          <option key={entry.code} value={entry.code}>
                            {entry.label} ({entry.code})
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field
                    label="Standing"
                    required
                    help="A membership that ended is recorded as ended, never removed."
                    {...form.of("status")}
                  >
                    {(control) => (
                      <Select
                        {...control}
                        value={status}
                        onChange={(event) => setStatus((event.target as HTMLSelectElement).value)}
                      >
                        {MEMBER_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {statusLabel(value)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              </fieldset>

              {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

              <div class="pk-cluster">
                <Button type="submit" variant="primary" loading={busy}>
                  {busy ? "Saving…" : "Save membership"}
                </Button>
                <Button onClick={onCancel} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
