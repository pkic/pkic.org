/** The list API resolves the owning-group label in the bounded backend page query. */
export function GroupBadge({ ownerGroupName }: { ownerGroupName: string }) {
  return <>{ownerGroupName}</>;
}
