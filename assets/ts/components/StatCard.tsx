import { h } from "preact";

interface StatCardProps {
  label: string;
  value: number | string;
  note?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

export function StatCard({ label, value, note, variant = "default" }: StatCardProps) {
  const variantClass = variant !== "default" ? ` text-${variant}` : "";
  return (
    <div class="stat-card">
      <div class={`val${variantClass}`}>{value}</div>
      <div class="lbl">{label}</div>
      {note && <div class="note">{note}</div>}
    </div>
  );
}
