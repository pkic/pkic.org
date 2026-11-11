/**
 * A screen's issues as badges: critical in the danger tone, warnings in the
 * warning tone, the worst first. Two at most; the rest are counted in one
 * more badge that names them on hover and to assistive technology.
 */
import type { ScreenIssue } from "../../../../../../../shared/event-screen-issues";
import { formatNumber } from "../../../../../../../shared/format-number";
import { Badge } from "../../../../../../ui/Badge";

const SHOWN = 2;

export function ScreenIssueBadges({ issues }: { issues: readonly ScreenIssue[] }) {
  if (!issues.length) return null;
  const rest = issues.slice(SHOWN);
  return (
    <>
      {issues.slice(0, SHOWN).map((issue) => (
        <Badge key={issue.code} tone={issue.severity === "critical" ? "danger" : "warn"} dot>
          {issue.label}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Badge tone="neutral" description={rest.map((issue) => issue.label).join(", ")}>
          +{formatNumber(rest.length)}
        </Badge>
      )}
    </>
  );
}
