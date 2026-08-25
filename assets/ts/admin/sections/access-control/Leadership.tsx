import { LeadershipPositions } from "./LeadershipPositions";

/** Global dated leadership records; group leadership is managed in the selected-group portal context. */
export function Leadership() {
  return (
    <div>
      <LeadershipPositions body="board" label="Board of Directors" />
      <LeadershipPositions body="executive_council" label="Executive Council" />
    </div>
  );
}
