import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";
import { Badge } from "../../../../ui/Badge";
/** What the category is, as the two badges the list and the edit page share. */
export function CategoryStanding({ category }: { category: MembershipCategoryCatalogEntry }) {
  return (
    <>
      <Badge tone="neutral" dot={false}>
        {category.isIndividual ? "Individual" : "Organization"}
      </Badge>
      <Badge tone={category.isVoting ? "ok" : "neutral"}>{category.isVoting ? "Voting" : "Non-voting"}</Badge>
    </>
  );
}
