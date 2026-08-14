interface StatCardProps {
  label: string;
  value: number | string;
  note?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  href?: string;
}

export function StatCard({ label, value, note, variant = "default", href }: StatCardProps) {
  const variantClass = variant !== "default" ? ` text-${variant}` : "";
  const content = (
    <>
      <div class={`val${variantClass}`}>{value}</div>
      <div class="lbl">{label}</div>
      {note && <div class="note">{note}</div>}
    </>
  );

  return href ? (
    <a class="stat-card stat-card-link" href={href}>
      {content}
    </a>
  ) : (
    <div class="stat-card">{content}</div>
  );
}
