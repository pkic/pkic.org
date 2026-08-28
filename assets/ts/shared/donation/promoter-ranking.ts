const PROMOTER_RANK_TIER: Record<number, string> = { 1: "gold", 2: "silver", 3: "bronze" };
const PROMOTER_RANK_CARD: Record<number, string> = { 1: "top-1", 2: "top-2", 3: "top-3" };

export function promoterRankTier(rank: number): string {
  if (rank <= 3) return PROMOTER_RANK_TIER[rank];
  if (rank <= 10) return "top-ten";
  return "other";
}

export function promoterRankCardClass(rank: number): string {
  return PROMOTER_RANK_CARD[rank] ?? (rank <= 10 ? "top-ten" : "");
}
