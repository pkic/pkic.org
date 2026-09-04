import { Textarea } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk">
      <Textarea
        rows={4}
        defaultValue={
          "The Post-Quantum Cryptography working group tracks migration guidance for " +
          "certificate authorities and relying parties."
        }
      />
    </div>
  );
}

export function Empty() {
  return (
    <div class="pk">
      <Textarea rows={3} placeholder="Add a note for the group leads…" />
    </div>
  );
}
