/**
 * Staff changing a person's headshot. A headshot belongs to the person, not
 * to a record that shows them, so every staff surface — the person's record
 * and a proposal's speaker roster alike — writes the one on their user record.
 */
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { userGravatarImportResponseSchema } from "../../../shared/schemas/route-contracts-headshots";
import { postJson } from "../api-client";
import type { ToastType } from "../ui";
import { headshotBodyEndpoint, type HeadshotEndpoint } from "./endpoints";
import { ADMIN_HEADSHOT_DISCLAIMER, showHeadshotDisclaimer } from "./upload";

const userHeadshotPath = (userId: string) => `/api/v1/users/${encodeURIComponent(userId)}`;

/** The person's own headshot, as staff upload or remove it. */
export function staffUserHeadshotEndpoint(userId: string): HeadshotEndpoint {
  return headshotBodyEndpoint(`${userHeadshotPath(userId)}/headshot`, successResponseSchema);
}

/** The label of the command that imports the person's public Gravatar. */
export const IMPORT_GRAVATAR_LABEL = "Import photo from Gravatar…";

/**
 * Fetches the address's public Gravatar and stores it as the person's
 * headshot. The same confirmation an upload asks for: whichever way the
 * picture arrives, somebody is asserting the consortium may publish it.
 * Resolves true once the photo is stored.
 */
export async function importUserGravatar(
  userId: string,
  notify: (message: string, type: ToastType) => void,
): Promise<boolean> {
  const accepted = await showHeadshotDisclaimer({
    title: "Before importing a photo",
    texts: ADMIN_HEADSHOT_DISCLAIMER,
    confirmText: "Proceed",
  });
  if (!accepted) return false;
  try {
    await postJson(`${userHeadshotPath(userId)}/gravatar`, {}, userGravatarImportResponseSchema);
    notify("Photo imported from Gravatar", "success");
    return true;
  } catch (cause) {
    notify((cause as Error).message, "error");
    return false;
  }
}
