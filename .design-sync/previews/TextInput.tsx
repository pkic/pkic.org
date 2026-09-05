import { TextInput } from "pkic-org-events-backend";

export function Default() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <TextInput placeholder="name@organization.org" defaultValue="tomas.riedel@example.org" />
      <TextInput placeholder="Search members…" />
    </div>
  );
}

export function Types() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <TextInput type="email" defaultValue="secretariat@pkic.org" />
      <TextInput type="date" defaultValue="2026-06-30" />
      <TextInput disabled defaultValue="Read-only value" />
    </div>
  );
}
