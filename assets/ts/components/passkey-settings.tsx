import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  passkeyBeginResponseSchema,
  passkeysListResponseSchema,
  passkeySummarySchema,
  type PasskeySummary,
} from "../../shared/schemas/passkeys";
import { successResponseSchema } from "../../shared/schemas/api-common";
import { deleteJson, getJson, postJson } from "../shared/api-client";
import { formatDateTime, showToast } from "../shared/ui";
import { confirmAction } from "./ConfirmDialog";
import { ErrorAlert } from "./ErrorAlert";
import { DataTable } from "./Table";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { RowActions } from "../ui/RowActions";
import { TextInput } from "../ui/TextControl";
import { Spinner } from "./Spinner";

function passkeyName(passkey: PasskeySummary): string {
  return passkey.deviceName ?? "Unnamed passkey";
}

export function PasskeySettings({
  toastTargetId,
  title = "Passkeys",
  className = "",
}: {
  toastTargetId: string;
  title?: string;
  className?: string;
}) {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  const load = useCallback(async () => {
    try {
      const response = await getJson("/api/v1/auth/passkeys", passkeysListResponseSchema);
      setPasskeys(response.passkeys);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnroll(event: Event) {
    event.preventDefault();
    setEnrolling(true);
    try {
      const begin = await postJson("/api/v1/auth/passkeys/register/begin", undefined, passkeyBeginResponseSchema);
      const credential = await startRegistration({
        optionsJSON: begin.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      await postJson(
        "/api/v1/auth/passkeys/register/complete",
        {
          challengeToken: begin.challengeToken,
          response: credential,
          deviceName: deviceName.trim() || undefined,
        },
        passkeySummarySchema,
      );
      showToast(toastTargetId, "Passkey added", "success");
      setDeviceName("");
      await load();
    } catch (reason) {
      showToast(toastTargetId, (reason as Error).message, "error");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleRemove(passkey: PasskeySummary) {
    const name = passkeyName(passkey);
    const confirmed = await confirmAction({
      title: `Remove passkey "${name}"?`,
      consequences: ["You'll need another passkey or magic link to sign in with this device"],
      confirmLabel: "Remove passkey",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/auth/passkeys/${passkey.id}`, successResponseSchema);
      showToast(toastTargetId, "Passkey removed", "success");
      await load();
    } catch (reason) {
      showToast(toastTargetId, (reason as Error).message, "error");
    }
  }

  if (error) return <ErrorAlert error={error} />;

  // No `.pk` of its own: this renders as a sibling panel inside the account
  // surface's `.pk` root, and a second one would only repaint the canvas.
  return (
    <Panel class={className || undefined}>
      <PanelHeader title={title} headingLevel={2} />
      <PanelBody class="pk-stack">
        <p class="pk-small pk-muted">
          Passkeys let you sign in with Touch ID, Face ID, or a hardware security key instead of a magic link. You can
          register more than one device.
        </p>

        {passkeysSupported ? (
          <form onSubmit={handleEnroll} class="pk-cluster">
            {/* The label used to be a bare `<label>` with no `for` and no id on
                the input beside it, so the field announced nothing. Field owns
                that pairing. */}
            <Field label="Device name (optional)">
              {(control) => (
                <TextInput
                  {...control}
                  value={deviceName}
                  onInput={(event) => setDeviceName((event.target as HTMLInputElement).value)}
                  placeholder="e.g. Work laptop"
                  disabled={enrolling}
                />
              )}
            </Field>
            {/* `loading` rather than `disabled`: a disabled button loses focus,
                which throws a keyboard user out of the form mid-enrolment. */}
            <Button type="submit" variant="primary" size="sm" loading={enrolling}>
              {enrolling ? "Waiting for passkey…" : "Add a passkey"}
            </Button>
          </form>
        ) : (
          <Alert tone="warn">This browser doesn&apos;t support passkeys.</Alert>
        )}

        {passkeys === null ? (
          <Spinner label="Loading passkeys…" />
        ) : (
          <DataTable
            caption={`${title} registered to this account`}
            columns={[
              { header: "Device", cell: (passkey: PasskeySummary) => passkeyName(passkey) },
              {
                header: "Last used",
                cell: (passkey: PasskeySummary) =>
                  passkey.lastUsedAt ? formatDateTime(passkey.lastUsedAt) : <span class="pk-muted">Never</span>,
                className: "pk-small",
              },
              {
                header: "Added",
                cell: (passkey: PasskeySummary) => formatDateTime(passkey.createdAt),
                className: "pk-small pk-nowrap",
              },
              {
                // The column used to have an empty `<th>`, which a screen
                // reader reaching the cell announces as nothing at all.
                header: "Actions",
                cell: (passkey: PasskeySummary) => (
                  <RowActions
                    label={`Actions for ${passkeyName(passkey)}`}
                    actions={[{ id: "remove", label: "Remove", onSelect: () => void handleRemove(passkey) }]}
                  />
                ),
              },
            ]}
            data={passkeys}
            rowKey={(passkey) => passkey.id}
            empty="No passkeys registered"
          />
        )}
      </PanelBody>
    </Panel>
  );
}
