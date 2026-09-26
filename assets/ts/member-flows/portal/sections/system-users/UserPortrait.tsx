/**
 * A person's portrait on their record, and the control that changes it.
 *
 * The picture is the affordance: you click the face, which is what #28 asked
 * for and what every network the reader already uses does. Before this, the
 * only way to set a portrait was a file input at the foot of the record under
 * "Account administration" — a heading that names staff work, on a control
 * whose subject is the person's own likeness.
 *
 * The tile is `PictureTile`, the same one an organization's logo uses. What
 * differs here is not the affordance but the two things a photograph of a
 * person needs before it is stored: the reader confirms they may publish it,
 * and the image is cropped square. Both already existed in the headshot
 * pipeline; this wires them to the tile.
 *
 * The endpoint differs by who is asking, not by what happens: a member holds
 * no `users:write`, so their own portrait is written through
 * `/users/current/headshot`.
 */
import { ApiClientError, deleteJson, requestJson } from "../../../../shared/api-client";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { replaceFile } from "../../../../shared/file-upload";
import { cropHeadshot } from "../../../../shared/headshot/crop";
import { confirmHeadshotUsage } from "../../../../shared/headshot/controller";
import { ADMIN_HEADSHOT_DISCLAIMER } from "../../../../shared/headshot/AdminHeadshotManager";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { myHeadshotDeleteResponseSchema, myHeadshotUploadResponseSchema } from "../../../../../shared/schemas/me";
import type { AvatarStatus } from "../../../../ui/Avatar";
import { PictureTile } from "../../../../components/PictureTile";
import { toast } from "../../ui";
import { CURRENT_USER_API } from "./SelfProfilePanel";

export function UserPortrait({
  status,
  userId,
  displayName,
  headshotUrl,
  isSelf,
  canEdit,
  onChanged,
}: {
  status?: AvatarStatus;
  userId: string;
  displayName: string;
  headshotUrl: string | null;
  isSelf: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  return (
    <PictureTile
      status={status}
      name={displayName}
      noun="photo"
      shape="round"
      size="mark"
      canChange={canEdit}
      imageUrl={headshotUrl}
      alt={`${displayName}'s photo`}
      hint="JPEG, PNG or WebP."
      removeConfirmation={isSelf ? "Remove your photo?" : `Remove ${displayName}'s photo?`}
      removeLabel="Remove photo"
      onUpload={async (file) => {
        /*
         * Publishing somebody's likeness is asserted before it is stored, not
         * after. Declining is an answer, so it returns `false` and the tile
         * reports neither success nor failure.
         */
        const accepted = await confirmHeadshotUsage({
          title: "Before uploading a photo",
          texts: ADMIN_HEADSHOT_DISCLAIMER,
          confirmText: "Proceed",
        });
        if (!accepted) return false;

        // Square, because every surface that draws this draws it round.
        const cropped = await cropHeadshot(file);
        if (!cropped) return false;

        if (isSelf) {
          await replaceFile(`${CURRENT_USER_API}/headshot`, cropped, myHeadshotUploadResponseSchema);
          return true;
        }
        await requestJson(`/api/v1/users/${encodeURIComponent(userId)}/headshot`, successResponseSchema, {
          method: "PUT",
          headers: { "Content-Type": cropped.type || "application/octet-stream" },
          body: cropped,
        });
        return true;
      }}
      onRemove={async () => {
        /*
         * A transport status is not something a reader can act on. "HTTP 500"
         * reached the toast unchanged once; the shared translation is what
         * turns it back into a sentence.
         */
        try {
          if (isSelf) {
            await deleteJson(`${CURRENT_USER_API}/headshot`, myHeadshotDeleteResponseSchema);
            return;
          }
          await deleteJson(`/api/v1/users/${encodeURIComponent(userId)}/headshot`, successResponseSchema);
        } catch (cause) {
          throw new Error(
            cause instanceof ApiClientError ? friendlyErrorMessage(cause.message) : "Could not remove the photo.",
            { cause },
          );
        }
      }}
      onChanged={() => void onChanged()}
      toast={toast}
    />
  );
}
