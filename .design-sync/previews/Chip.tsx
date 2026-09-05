import { Chip } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk pk-cluster">
      <Chip>Post-Quantum Cryptography</Chip>
      <Chip>PKI Maturity Model</Chip>
      <Chip>EV Code Signing</Chip>
      <Chip>Document Signing</Chip>
    </div>
  );
}

export function Toggles() {
  return (
    <div class="pk pk-cluster">
      <Chip pressed onToggle={() => {}}>
        Steering member
      </Chip>
      <Chip pressed onToggle={() => {}}>
        Participant member
      </Chip>
      <Chip pressed={false} onToggle={() => {}}>
        Associate member
      </Chip>
      <Chip pressed={false} onToggle={() => {}}>
        Application pending
      </Chip>
    </div>
  );
}

export function AppliedFilters() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <p class="pk-small pk-muted">Filtering 42 member organizations</p>
      <div class="pk-cluster">
        <Chip pressed onToggle={() => {}} onRemove={() => {}} removeLabel="Group: Post-Quantum Cryptography">
          Group: Post-Quantum Cryptography
        </Chip>
        <Chip onRemove={() => {}} removeLabel="Status: Active">
          Status: Active
        </Chip>
        <Chip onRemove={() => {}} removeLabel="Region: Europe">
          Region: Europe
        </Chip>
      </div>
    </div>
  );
}

/**
 * A skill shelf: each chip carries how many members vouched for it, and its
 * tint ranks it against the rest at a glance.
 */
export function VouchedSkills() {
  const skills: [string, number][] = [
    ["Signature validation", 21],
    ["eIDAS / trust services", 17],
    ["Post-quantum migration", 12],
    ["Certificate policy", 11],
    ["CBOM", 9],
    ["Certificate transparency", 6],
    ["Auditing (ETSI)", 4],
  ];
  const top = skills[0][1];
  return (
    <div class="pk pk-cluster">
      {skills.map(([name, votes]) => (
        <Chip key={name} count={votes} strength={votes / top}>
          {name}
        </Chip>
      ))}
    </div>
  );
}
