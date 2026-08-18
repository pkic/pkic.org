import type { SponsorshipPipelineStage } from "../../types";

export function stageBadgeClass(stage: SponsorshipPipelineStage): string {
  if (stage === "active") return "text-bg-success";
  if (stage === "lapsed") return "text-bg-secondary";
  if (stage === "payment_pending") return "text-bg-warning";
  return "text-bg-light";
}

export function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}
