import { useId, useRef, useState } from "preact/hooks";
import { useContractForm } from "../../../../hooks/useContractForm";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  userEmailAddResponseSchema,
  userEmailAddSchema,
  userEmailsListResponseSchema,
  type UserEmailRecord,
} from "../../../../../shared/schemas/user-emails";
import { fmtDate, toast } from "../../ui";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { TextInput } from "../../../../ui/TextControl";
import "../../../../ui/Content.css";

export function UserEmailAddressesPanel({
  userId,
  primaryEmail,
  canWrite,
}: {
  userId: string;
  primaryEmail: string;
  canWrite: boolean;
}) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const headingId = useId();
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  /*
   * One basis for validation: the contract the route parses. `if (!trimmed)
   * return` silently did nothing, and a malformed address was refused by the
   * server as a toast rather than marked on the field that caused it.
   */
  const form = useContractForm(userEmailAddSchema, { email: newEmail.trim() });

  async function handleAdd(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return;
    setAdding(true);
    try {
      await postJson(`/api/v1/users/${encodeURIComponent(userId)}/emails`, checked.data, userEmailAddResponseSchema);
      toast("Email added", "success");
      setNewEmail("");
      form.reset();
      await tableRef.current?.reload();
    } catch (error) {
      // A server refusal names its fields the way the contract does.
      toast(form.refuse(error), "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(emailId: string, email: string) {
    const confirmed = await confirmAction({
      title: `Remove ${email} from this account?`,
      consequences: ["This secondary email is no longer associated with this account"],
      confirmLabel: "Remove email",
    });
    if (!confirmed) return;
    try {
      await deleteJson(
        `/api/v1/users/${encodeURIComponent(userId)}/emails/${encodeURIComponent(emailId)}`,
        successResponseSchema,
      );
      toast("Email removed", "success");
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  return (
    /* `aria-labelledby` makes the section a named region, so a reader can
       reach "Email addresses" directly instead of one of several unnamed
       panels on the user record. */
    <Panel class="pk" aria-labelledby={headingId}>
      <PanelHeader id={headingId} title="Email addresses" />
      <PanelBody class="pk-stack">
        <p class="pk-small">
          Secondary emails are for account association and record-keeping only — they do not allow signing in.
        </p>
        <dl class="pk-datalist">
          <dt>Primary</dt>
          <dd>{primaryEmail}</dd>
        </dl>
        {canWrite && (
          <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={handleAdd}>
            {/* The input had a placeholder and no label, so it was announced
                as an unnamed edit field. The label names it; the placeholder
                is now only an example of the format. */}
            <Field label="Add a secondary email" {...form.of("email")}>
              {(control) => (
                <TextInput
                  {...control}
                  type="email"
                  name="email"
                  placeholder="another@example.com"
                  value={newEmail}
                  onInput={(event) => setNewEmail((event.target as HTMLInputElement).value)}
                  disabled={adding}
                />
              )}
            </Field>
            <div class="pk-cluster">
              <Button type="submit" variant="primary" size="sm" loading={adding} disabled={adding || !newEmail.trim()}>
                {adding ? "Adding…" : "Add email"}
              </Button>
            </div>
          </form>
        )}
        <ApiDataTable
          caption="Secondary email addresses"
          endpoint={`/api/v1/users/${encodeURIComponent(userId)}/emails`}
          responseSchema={userEmailsListResponseSchema}
          resolve={(response) => response.emails}
          resolvePage={(response) => response.page}
          paginate
          initialPageSize={10}
          initialSort="email"
          searchPlaceholder="Search secondary emails…"
          actionsRef={tableRef}
          rowKey={(email) => email.id}
          empty="No secondary emails"
          columns={[
            {
              header: "Secondary email",
              cell: (email) => email.email,
              sort: { asc: "email", desc: "-email" },
            },
            {
              header: "Added",
              cell: (email) => <span class="pk-small pk-mono">{fmtDate(email.createdAt)}</span>,
              sort: { asc: "created_at", desc: "-created_at" },
            },
            ...(canWrite
              ? [
                  {
                    header: "Actions",
                    cell: (email: UserEmailRecord) => (
                      <RowActions
                        subject={email.email}
                        actions={[
                          {
                            id: "remove",
                            label: "Remove email",
                            onSelect: () => void handleRemove(email.id, email.email),
                          },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </PanelBody>
    </Panel>
  );
}
