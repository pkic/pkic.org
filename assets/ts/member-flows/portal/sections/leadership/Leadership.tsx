import { LeadershipPositions } from "./LeadershipPositions";

/** Global dated leadership records; group leadership is managed in the selected-group portal context. */
export function Leadership({ canGrant, canRevoke }: { canGrant: boolean; canRevoke: boolean }) {
  return (
    <div>
      <LeadershipPositions body="board" label="Board of Directors" canGrant={canGrant} canRevoke={canRevoke} />
      <LeadershipPositions
        body="executive_council"
        label="Executive Council"
        canGrant={canGrant}
        canRevoke={canRevoke}
      />
    </div>
  );
}
