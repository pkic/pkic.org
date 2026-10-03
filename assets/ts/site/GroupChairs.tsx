import type { GroupDirectoryResponse } from "../../shared/schemas/group-directory";
import { PublicPersonCard } from "./PublicPersonCard";
import "./leadership.css";
export function GroupChairsView({
  leaders,
  wgLabel,
  mode,
}: {
  leaders: GroupDirectoryResponse["leadership"];
  wgLabel: string;
  mode: "compact" | "card";
}) {
  const avatarSize = mode === "card" ? "small" : "default";
  const cards = (
    <>
      {leaders.map((assignment) => (
        <PublicPersonCard
          key={`${assignment.sourceGroup?.id ?? "private-source"}:${assignment.roleId}:${assignment.person.name}`}
          person={assignment.person}
          role={`${wgLabel} ${assignment.title}`}
          avatarSize={avatarSize}
          from={assignment.startsAt}
          till={assignment.endsAt}
        />
      ))}
    </>
  );

  if (mode === "card") return cards;

  return (
    <>
      <div class="wg-leadership-label">Working Group Leadership</div>
      <div class="consortium-leaders">{cards}</div>
    </>
  );
}
