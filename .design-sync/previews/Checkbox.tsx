import { Checkbox } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Checkbox
        name="agreement"
        defaultChecked
        label="I accept the PKI Consortium membership agreement"
        hint="Version 4.2, published 12 January 2026."
      />
      <Checkbox name="roster" label="List me on the public working group roster" />
    </div>
  );
}

export function Group() {
  return (
    <div class="pk">
      <fieldset class="pk-fieldset pk-fieldset--boxed pk-stack pk-stack--tight">
        <legend class="pk-strong">Working group notifications</legend>
        <Checkbox name="notify" value="agenda" defaultChecked label="Meeting agendas and minutes" />
        <Checkbox
          name="notify"
          value="ballots"
          defaultChecked
          label="Ballots open for voting"
          hint="Sent to every voting representative of the member organization."
        />
        <Checkbox name="notify" value="drafts" label="New draft documents for review" />
        <Checkbox name="notify" value="digest" label="Monthly consortium digest" />
      </fieldset>
    </div>
  );
}

export function States() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Checkbox defaultChecked label="Post-Quantum Cryptography" hint="Selected" />
      <Checkbox label="PKI Maturity Model" hint="Available to join" />
      <Checkbox disabled defaultChecked label="Board of Directors" hint="Disabled — membership is set by election" />
      <Checkbox disabled label="EV Code Signing" hint="Disabled — requires a sponsoring member tier" />
    </div>
  );
}
