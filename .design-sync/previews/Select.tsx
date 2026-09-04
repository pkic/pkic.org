import { Field, Select } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk pk-form">
      <Select defaultValue="pqc">
        <option value="pqc">Post-Quantum Cryptography</option>
        <option value="pki-maturity">PKI Maturity Model</option>
        <option value="ev-code-signing">EV Code Signing</option>
        <option value="doc-signing">Document Signing</option>
      </Select>

      <Select defaultValue="">
        <option value="">Select a working group…</option>
        <option value="pqc">Post-Quantum Cryptography</option>
        <option value="pki-maturity">PKI Maturity Model</option>
      </Select>
    </div>
  );
}

export function InField() {
  return (
    <div class="pk pk-form">
      <Field label="Working group" required help="Determines which ballots you are invited to vote on.">
        {(control) => (
          <Select {...control} defaultValue="pqc">
            <option value="pqc">Post-Quantum Cryptography</option>
            <option value="pki-maturity">PKI Maturity Model</option>
            <option value="ev-code-signing">EV Code Signing</option>
          </Select>
        )}
      </Field>

      <Field label="Role in the group" help="Chairs and secretaries are confirmed by the steering committee.">
        {(control) => (
          <Select {...control} defaultValue="member">
            <option value="member">Member</option>
            <option value="chair">Chair</option>
            <option value="secretary">Secretary</option>
          </Select>
        )}
      </Field>
    </div>
  );
}

export function States() {
  return (
    <div class="pk pk-form">
      <Field label="Certificate profile" state="ok" message="Profile matches the current CA/Browser Forum baseline.">
        {(control) => (
          <Select {...control} defaultValue="tls-server">
            <option value="tls-server">TLS server authentication</option>
            <option value="code-signing">Code signing</option>
          </Select>
        )}
      </Field>

      <Field label="Signature algorithm" state="invalid" message="Select an algorithm before submitting the charter.">
        {(control) => (
          <Select {...control} defaultValue="">
            <option value="">Select an algorithm…</option>
            <option value="ml-dsa-65">ML-DSA-65</option>
            <option value="ecdsa-p256">ECDSA P-256</option>
          </Select>
        )}
      </Field>

      <Field label="Member organization" help="Fixed by the membership agreement on file.">
        {(control) => (
          <Select {...control} disabled defaultValue="securetrust">
            <option value="securetrust">SecureTrust CA</option>
          </Select>
        )}
      </Field>
    </div>
  );
}
