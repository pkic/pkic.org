import { Field, Select, TextInput, Textarea } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk pk-form">
      <Field label="Work email" help="Used for working group ballots and meeting invitations.">
        {(control) => <TextInput {...control} type="email" defaultValue="m.laurent@securetrust-ca.eu" />}
      </Field>

      <Field label="Member organization" required help="The legal entity named on the membership agreement.">
        {(control) => <TextInput {...control} defaultValue="SecureTrust CA" />}
      </Field>
    </div>
  );
}

export function States() {
  return (
    <div class="pk pk-form">
      <Field label="Member organization" state="ok" message="Matched to SecureTrust CA, member since 2023.">
        {(control) => <TextInput {...control} defaultValue="SecureTrust CA" />}
      </Field>

      <Field
        label="Contact email"
        state="advisory"
        message="A personal domain is accepted, but ballots are announced to the organization's domain."
      >
        {(control) => <TextInput {...control} type="email" defaultValue="m.laurent@gmail.com" />}
      </Field>

      <Field label="Charter scope" required state="invalid" message="Describe the scope in at least 40 characters.">
        {(control) => <Textarea {...control} rows={2} defaultValue="PQC migration" />}
      </Field>
    </div>
  );
}

export function ControlTypes() {
  return (
    <div class="pk pk-form">
      <Field label="Working group" required help="Groups you are eligible to join under your membership tier.">
        {(control) => (
          <Select {...control} defaultValue="pqc">
            <option value="pqc">Post-Quantum Cryptography</option>
            <option value="pki-maturity">PKI Maturity Model</option>
            <option value="ev-code-signing">EV Code Signing</option>
          </Select>
        )}
      </Field>

      <Field label="Chartered on" help="The date the steering committee approved the charter.">
        {(control) => <TextInput {...control} type="date" defaultValue="2026-02-11" />}
      </Field>

      <Field label="Membership agreement reference" help="Assigned by the secretariat; not editable here.">
        {(control) => <TextInput {...control} disabled defaultValue="PKIC-MA-2023-0148" />}
      </Field>
    </div>
  );
}
