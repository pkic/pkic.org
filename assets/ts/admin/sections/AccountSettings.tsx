import { PasskeySettings } from "../../components/passkey-settings";

export function AccountSettings() {
  return (
    <PasskeySettings
      toastTargetId="toast-area"
      title="Security — Passkeys"
      className="adm-security-card"
      tableHeaderClass="table-dark"
    />
  );
}
