export function ResourceCapabilities({ capabilities }: { capabilities: readonly string[] }) {
  if (capabilities.length === 0) return <span class="text-muted">None</span>;
  return (
    <div class="d-flex flex-wrap gap-1">
      {capabilities.map((capability) => (
        <span key={capability} class="badge text-bg-secondary">
          {capability.replaceAll("_", " ")}
        </span>
      ))}
    </div>
  );
}
