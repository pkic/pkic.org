import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "preact/hooks";
import { LAST_SIGN_IN_METHOD } from "../../shared/auth-errors";
import {
  passkeysListResponseSchema,
  type PasskeyDeleteQuery,
  type PasskeySummary,
} from "../../shared/schemas/passkeys";
import { successResponseSchema } from "../../shared/schemas/api-common";
import { ApiClientError, deleteJson, getJson } from "../shared/api-client";
import { formatDateTime, showToast } from "../shared/ui";
import { confirmAction } from "./ConfirmDialog";
import { ErrorAlert } from "./ErrorAlert";
import { usePasskeyEnrollment } from "./passkey-enrollment";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { InputGroup } from "../ui/InputGroup";
import { Menu } from "../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { RowActions } from "../ui/RowActions";
import { RowList, RowListItem } from "../ui/RowList";
import { TextInput } from "../ui/TextControl";
import { Spinner } from "./Spinner";

function passkeyName(passkey: PasskeySummary): string {
  return passkey.deviceName ?? "Unnamed passkey";
}

export function PasskeySettings({ toastTargetId }: { toastTargetId: string }) {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [adding, setAdding] = useState(false);
  const { enroll, enrolling } = usePasskeyEnrollment();
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
    setEnrollmentError(null);
    const failure = await enroll(deviceName);
    if (failure) {
      setEnrollmentError(failure);
      return;
    }
    showToast(toastTargetId, "Passkey added", "success");
    setDeviceName("");
    setAdding(false);
    await load();
  }

  async function handleRemove(passkey: PasskeySummary) {
    const name = passkeyName(passkey);
    const confirmed = await confirmAction({
      title: `Remove passkey "${name}"?`,
      consequences: [
        (passkeys?.length ?? 0) > 1
          ? "You can still sign in with your other passkeys."
          : "This is your only passkey. Until you add another, you'll sign in with an email link.",
      ],
      confirmLabel: "Remove passkey",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/auth/passkeys/${passkey.id}`, successResponseSchema);
      showToast(toastTargetId, "Passkey removed", "success");
      await load();
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.code === LAST_SIGN_IN_METHOD) {
        await removeLastWayToSignIn(passkey);
        return;
      }
      showToast(toastTargetId, (reason as Error).message, "error");
    }
  }

  /**
   * The server refuses removing the last way to sign in until its owner
   * confirms, so a compromised passkey can still be revoked. Reaching this
   * means no email address can sign in either, so no email link will help.
   */
  async function removeLastWayToSignIn(passkey: PasskeySummary) {
    const confirmed = await confirmAction({
      title: "Remove your last way to sign in?",
      body: `"${passkeyName(passkey)}" is your only passkey, and none of your email addresses can sign you in.`,
      consequences: [
        "You'll be signed out everywhere else",
        "You stay signed in here, so you can add a new passkey right away",
        "If you're signed out before you add one, contact us to get back into your account",
      ],
      confirmLabel: "Remove passkey",
      tone: "danger",
    });
    if (!confirmed) return;
    const query = new URLSearchParams({ confirmLastMethod: "true" } satisfies PasskeyDeleteQuery);
    try {
      await deleteJson(`/api/v1/auth/passkeys/${passkey.id}?${query}`, successResponseSchema);
      showToast(toastTargetId, "Passkey removed", "success");
      await load();
      // Offer the replacement at once: this session is now the only way back in.
      setEnrollmentError(null);
      setAdding(true);
    } catch (reason) {
      showToast(toastTargetId, (reason as Error).message, "error");
    }
  }

  if (error) return <ErrorAlert error={error} />;

  return (
    <Panel aria-label="Passkeys">
      <PanelHeader
        title="Passkeys"
        headingLevel={2}
        menu={
          <Menu
            label="Passkeys actions"
            align="end"
            items={[
              {
                id: "add",
                label: "Add a passkey",
                onSelect: () => {
                  setEnrollmentError(null);
                  setAdding(true);
                },
              },
            ]}
          />
        }
      />
      <PanelBody flush>
        {passkeys === null ? (
          <div class="pk-panel__body">
            <Spinner label="Loading passkeys…" />
          </div>
        ) : passkeys.length === 0 ? (
          <p class="pk-panel__body pk-muted pk-small">No passkeys registered</p>
        ) : (
          <RowList label="Passkeys">
            {passkeys.map((passkey) => (
              <RowListItem
                key={passkey.id}
                meta={passkey.lastUsedAt ? `Last used ${formatDateTime(passkey.lastUsedAt)}` : "Never used"}
                end={
                  <RowActions
                    subject={passkeyName(passkey)}
                    actions={[{ id: "remove", label: "Remove", onSelect: () => void handleRemove(passkey) }]}
                  />
                }
              >
                {passkeyName(passkey)}
              </RowListItem>
            ))}
          </RowList>
        )}
      </PanelBody>

      <Dialog
        open={adding}
        viewer
        title="Add a passkey"
        closeLabel="Close add a passkey"
        description="Save a passkey in your password manager, on your device with Touch ID or Face ID, or on a hardware security key. Choose where to save it when prompted."
        confirmLabel="Close"
        onConfirm={() => setAdding(false)}
        onCancel={() => setAdding(false)}
      >
        {enrollmentError && <Alert tone="danger">{enrollmentError}</Alert>}
        {passkeysSupported ? (
          <form onSubmit={handleEnroll}>
            {/* Field owns the label pairing; InputGroup keeps the button one control tall beside the input. */}
            <Field label="Device name (optional)">
              {(control) => (
                <InputGroup>
                  <TextInput
                    {...control}
                    value={deviceName}
                    onInput={(event) => setDeviceName((event.target as HTMLInputElement).value)}
                    placeholder="e.g. Work laptop"
                    disabled={enrolling}
                  />
                  {/* `loading` rather than `disabled`: a disabled button loses focus,
                      which throws a keyboard user out of the form mid-enrolment. */}
                  <Button type="submit" variant="primary" loading={enrolling}>
                    {enrolling ? "Waiting for passkey…" : "Add a passkey"}
                  </Button>
                </InputGroup>
              )}
            </Field>
          </form>
        ) : (
          <Alert tone="warn">This browser doesn&apos;t support passkeys.</Alert>
        )}
      </Dialog>
    </Panel>
  );
}
