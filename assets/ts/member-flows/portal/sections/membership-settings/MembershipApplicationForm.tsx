/**
 * Membership application form — the questions an applicant answers once their
 * email address is verified.
 *
 * Its own page rather than the middle panel of a "Membership Settings" screen
 * (#40): it is a form editor, it is where a staff edit becomes a change to the
 * public join flow, and somebody sent here to change a question needs an
 * address to be sent to.
 */
import {
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationFormDefinitionUpdateSchema,
  type MembershipApplicationPolicyField,
} from "../../../../../shared/schemas/membership-application-form";
import type { FormDefinitionUpdateInput } from "../../../../../shared/schemas/forms";
import { useCallback, useEffect, useState } from "preact/hooks";
import { Badge as StatusBadge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { FormDefinitionEditor, type EditableFormDetail } from "../../../../components/forms/FormDefinitionEditor";
import { Badge } from "../../../../ui/Badge";
import { Menu } from "../../../../ui/Menu";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { getJson, patchJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

const APPLICATION_FORM_DEFINITION_API = "/api/v1/members/applications/form/definition";

export function MembershipApplicationForm({ canWrite }: { canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<EditableFormDetail | null>(null);
  const [policyFields, setPolicyFields] = useState<MembershipApplicationPolicyField[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(
        APPLICATION_FORM_DEFINITION_API,
        membershipApplicationFormDefinitionResponseSchema,
      );
      setDetail({ form: response.form, fields: response.fields });
      setPolicyFields(response.policyFields);
      setUpdatedAt(response.form.updatedAt);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function save(payload: FormDefinitionUpdateInput): Promise<string> {
    if (!detail || !updatedAt) throw new Error("The membership application form is unavailable.");
    const input = membershipApplicationFormDefinitionUpdateSchema.parse({ ...payload, expectedUpdatedAt: updatedAt });
    const response = await patchJson(
      APPLICATION_FORM_DEFINITION_API,
      input,
      membershipApplicationFormDefinitionResponseSchema,
    );
    setDetail({ form: response.form, fields: response.fields });
    setPolicyFields(response.policyFields);
    setUpdatedAt(response.form.updatedAt);
    toast("Membership application form saved", "success");
    return response.form.key;
  }

  return (
    <div class="pk pk-stack">
      <PageHeader
        actions={
          canWrite && detail && !editing ? (
            <Menu
              label="Application form actions"
              align="end"
              items={[{ id: "edit", label: "Edit form", onSelect: () => setEditing(true) }]}
            />
          ) : undefined
        }
        title="Membership application form"
        description="The additional questions shown after email verification and category selection. Identity, organization, category, and required policy fields remain owned by the membership workflow."
      />
      <Panel aria-label="Membership application form">
        <PanelBody class="pk-stack">
          {loading ? (
            <Spinner label="Loading the membership application form…" />
          ) : error ? (
            <ErrorAlert error={error} />
          ) : detail ? (
            <>
              <div class="pk-stack pk-stack--snug">
                <h3>Required policy acknowledgements</h3>
                <p class="pk-small">These workflow-owned consent fields are mandatory and cannot be changed here.</p>
                <ul class="pk-stack pk-stack--tight" aria-label="Required policy acknowledgements">
                  {policyFields.map((field) => (
                    <li class="pk-cluster pk-cluster--start" key={field.key}>
                      <span>{field.label}</span>
                      <Badge tone="info">Required</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              {canWrite && editing ? (
                <FormDefinitionEditor
                  mode="edit"
                  detail={detail}
                  purposes={["application"]}
                  onSave={(payload) => save(payload as FormDefinitionUpdateInput)}
                  onSaved={() => setEditing(false)}
                  onCancel={() => setEditing(false)}
                  onError={(message) => toast(message, "error")}
                />
              ) : (
                <div class="pk-stack pk-stack--snug">
                  <div class="pk-cluster">
                    <strong>{detail.form.title}</strong>
                    <StatusBadge status={detail.form.status} />
                  </div>
                  {detail.form.description && <p class="pk-small">{detail.form.description}</p>}
                  <ul class="pk-stack pk-stack--tight" aria-label="Membership application form fields">
                    {detail.fields.map((field) => (
                      <li class="pk-cluster pk-cluster--start" key={field.key}>
                        <span>
                          {field.label} <span class="pk-muted">({field.fieldType})</span>
                        </span>
                        {field.required && <Badge tone="info">Required</Badge>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}
