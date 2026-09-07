import { useState } from "preact/hooks";
import {
  INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST,
  individualMembershipGrantSchema,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";

/**
 * Making somebody who already has an account a member in their own right.
 *
 * Membership is a grant, not a creation: the person exists — they registered
 * for an event, they were invited, they came across the migration — and this
 * records that the consortium now counts them as a member. Issue #24 reports
 * that only the API could do it, so an individual member could not be added
 * without curl.
 *
 * Only the individual half of the category vocabulary is offered. An org-tied
 * category belongs to an organization's Member aggregate, whose
 * representatives inherit it, and is chosen where that organization is.
 */
export function GrantIndividualMembershipForm({
  categories,
  onGranted,
  onCancel,
}: {
  /** Reference data for the category labels; the codes are the contract. */
  categories: readonly MembershipCategoryCatalogEntry[];
  onGranted: () => void;
  onCancel: () => void;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [membershipCategory, setMembershipCategory] = useState<string>(INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST[0]);
  const [activationReason, setActivationReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // One basis for validation: the same contract the route parses.
  const form = useContractForm(individualMembershipGrantSchema, {
    userId: user?.id ?? "",
    membershipCategory,
    activationReason,
  });

  function labelFor(code: string): string {
    const entry = categories.find((candidate) => candidate.code === code);
    return entry ? `${entry.label} (${code})` : code;
  }

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
      await postJson("/api/v1/members/capacities", checked.data, memberCapacityMutationResponseSchema);
      toast("Membership granted", "success");
      onGranted();
    } catch (caught) {
      // A server refusal names its fields the way the contract does.
      const message = form.refuse(caught);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="pk pk-stack">
      {/* The page's way back: the grant has its own address, so leaving it is
          navigation rather than the disappearance of a layer. */}
      <div class="pk-cluster">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          ← All members
        </Button>
      </div>
      <Panel aria-label="Grant a membership">
        <PanelHeader title="Grant a membership" headingLevel={2} />
        <PanelBody class="pk-stack pk-stack--snug">
          {/* The rule this page turns on, said once at the top rather than as
              help under the field it constrains. */}
          <p class="pk-muted pk-small">
            An individual membership is granted to somebody who already has an account. An organization's
            representatives inherit its membership and are not granted one here.
          </p>
          <form noValidate class="pk-form" {...form.handlers} onSubmit={(event) => void submit(event)}>
            {/*
              No legend: three fields under a panel that has already said what
              this page is for, and a legend above each label was one heading
              too many for every row. The fieldset stays because it is what
              disables the whole form while the grant is in flight.
            */}
            <fieldset class="pk-fieldset pk-field" disabled={busy}>
              <div class="pk-stack pk-stack--snug">
                <Field label="Person" required {...form.of("userId")}>
                  {() => <UserPicker value={user} onChange={setUser} disabled={busy} placeholder="email or name" />}
                </Field>
                <Field label="Category" required {...form.of("membershipCategory")}>
                  {(control) => (
                    <Select
                      {...control}
                      value={membershipCategory}
                      onChange={(event) => setMembershipCategory((event.target as HTMLSelectElement).value)}
                    >
                      {INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST.map((code) => (
                        <option key={code} value={code}>
                          {labelFor(code)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {/* The grant activates the membership at once, so it is
                    recorded with a reason — the same rule every other
                    immediate activation follows. */}
                <Field
                  label="Activation reason"
                  required
                  help="Recorded in the audit log."
                  {...form.of("activationReason")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      value={activationReason}
                      onInput={(event) => setActivationReason(event.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
            </fieldset>

            {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={busy}>
                {busy ? "Granting…" : "Grant membership"}
              </Button>
              <Button onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
