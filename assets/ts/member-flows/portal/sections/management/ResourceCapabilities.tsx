import { Badge } from "../../../../ui/Badge";

export function ResourceCapabilities({ capabilities }: { capabilities: readonly string[] }) {
  if (capabilities.length === 0) return <span class="pk-muted">None</span>;
  return (
    <div class="pk-cluster">
      {capabilities.map((capability) => (
        // A capability name is a label, not a status, so the tone dot would
        // claim a meaning the list does not have.
        <Badge key={capability} tone="neutral" dot={false}>
          {capability.replaceAll("_", " ")}
        </Badge>
      ))}
    </div>
  );
}
