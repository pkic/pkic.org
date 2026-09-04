import { Radio } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Radio
        name="attendance"
        value="in-person"
        defaultChecked
        label="Attending in person"
        hint="Amsterdam, 14–15 April 2026."
      />
      <Radio name="attendance" value="remote" label="Attending remotely" hint="A joining link is sent the day before." />
      <Radio name="attendance" value="decline" label="Not attending" />
    </div>
  );
}

export function Group() {
  return (
    <div class="pk">
      <fieldset class="pk-fieldset pk-fieldset--boxed pk-stack pk-stack--tight">
        <legend class="pk-strong">Membership tier</legend>
        <Radio
          name="tier"
          value="steering"
          defaultChecked
          label="Steering member"
          hint="Board eligibility, chairs working groups, one vote per organization."
        />
        <Radio
          name="tier"
          value="participant"
          label="Participant member"
          hint="Joins any working group and votes on ballots."
        />
        <Radio name="tier" value="associate" label="Associate member" hint="Observes working groups; no ballot vote." />
      </fieldset>
    </div>
  );
}

export function States() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Radio name="charter" value="approved" defaultChecked label="Approve the charter as drafted" />
      <Radio name="charter" value="revise" label="Return to the group for revision" />
      <Radio
        name="charter"
        value="withdraw"
        disabled
        label="Withdraw the charter"
        hint="Disabled — only the group chair may withdraw a charter."
      />
      <Radio
        name="charter-recorded"
        value="recorded"
        disabled
        defaultChecked
        label="Recorded as approved on 11 February 2026"
        hint="Disabled — the ballot is closed."
      />
    </div>
  );
}
