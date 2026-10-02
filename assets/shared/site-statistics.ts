import type { PortalLoginFact } from "./schemas/portal-login-copy";

/** The same consortium figures appear on the home page and portal sign-in. */
export function siteStatistics(
  workingGroupCount: number,
  memberCount?: number,
): Array<PortalLoginFact & { href: string }> {
  return [
    { value: String(memberCount ?? "—"), label: "Members", memberCount: "all", href: "/members/" },
    { value: "~1K", label: "Representatives", href: "/members/" },
    { value: String(workingGroupCount), label: "Working Groups", href: "/wg/" },
  ];
}
