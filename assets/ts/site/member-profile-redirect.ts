import { memberProfilePathsSchema } from "../../shared/schemas/member-profile-paths";
import { memberProfileHref } from "../../shared/member-profile-url";

/** Preserve old query-based profile links using a published public ID-to-slug map. */
async function redirect(): Promise<void> {
  const id = new URL(window.location.href).searchParams.get("id");
  if (!id) return;
  const response = await fetch("/_published/members/paths.json");
  if (!response.ok) throw new Error("Published member addresses are unavailable");
  const paths = memberProfilePathsSchema.parse(await response.json());
  const member = paths[id];
  if (member) window.location.replace(memberProfileHref(member));
}
void redirect().catch(() => {
  const status = document.querySelector("[data-profile-redirect-status]");
  if (status) status.textContent = "We could not open this profile. Please find the member in the directory.";
});
