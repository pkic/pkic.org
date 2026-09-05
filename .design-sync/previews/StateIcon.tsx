import { Field, StateIcon, TextInput } from "pkic-org-events-backend";

export function InField() {
  return (
    <div class="pk pk-form">
      <Field label="Member organization" state="ok" message="Matched to SecureTrust CA, member since 2023.">
        {(control) => <TextInput {...control} defaultValue="SecureTrust CA" />}
      </Field>

      <Field label="Contact email" state="advisory" message="A personal domain is accepted, but ballots go to the organization's domain.">
        {(control) => <TextInput {...control} type="email" defaultValue="m.laurent@gmail.com" />}
      </Field>

      <Field label="Charter reference" state="invalid" message="No charter matches PKIC-WG-2026-0000.">
        {(control) => <TextInput {...control} defaultValue="PKIC-WG-2026-0000" />}
      </Field>
    </div>
  );
}

export function Marks() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <div class="pk-field pk-field--ok">
        <p class="pk-field__message">
          <StateIcon state="ok" class="pk-field__message-icon" />
          Certificate chain validates to a root on the consortium trust list.
        </p>
      </div>

      <div class="pk-field pk-field--advisory">
        <p class="pk-field__message">
          <StateIcon state="advisory" class="pk-field__message-icon" />
          The signing certificate expires in 21 days; submission is still accepted.
        </p>
      </div>

      <div class="pk-field pk-field--invalid">
        <p class="pk-field__message">
          <StateIcon state="invalid" class="pk-field__message-icon" />
          The membership agreement is unsigned, so the application cannot be submitted.
        </p>
      </div>
    </div>
  );
}

export function Checklist() {
  return (
    <div class="pk pk-form">
      <p class="pk-strong">Post-Quantum Cryptography — charter readiness</p>

      <div class="pk-field pk-field--ok">
        <p class="pk-field__message">
          <StateIcon state="ok" class="pk-field__message-icon" />
          Chair and secretary confirmed
        </p>
      </div>

      <div class="pk-field pk-field--ok">
        <p class="pk-field__message">
          <StateIcon state="ok" class="pk-field__message-icon" />
          Five sponsoring member organizations
        </p>
      </div>

      <div class="pk-field pk-field--advisory">
        <p class="pk-field__message">
          <StateIcon state="advisory" class="pk-field__message-icon" />
          Scope statement is shorter than the steering committee usually accepts
        </p>
      </div>

      <div class="pk-field pk-field--invalid">
        <p class="pk-field__message">
          <StateIcon state="invalid" class="pk-field__message-icon" />
          Charter document not yet uploaded
        </p>
      </div>
    </div>
  );
}
