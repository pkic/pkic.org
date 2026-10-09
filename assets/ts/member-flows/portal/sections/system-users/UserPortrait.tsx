/**
 * A person's portrait on their record, and the control that changes it.
 *
 * The picture is the affordance: you click the face, which is what #28 asked
 * for and what every network the reader already uses does. Before this, the
 * only way to set a portrait was a file input at the foot of the record under
 * "Account administration" — a heading that names staff work, on a control
 * whose subject is the person's own likeness.
 *
 * The tile is the shared `HeadshotTile`, which carries the consent and the
 * square crop every photograph of a person passes through before it is
 * stored.
 *
 * The endpoint differs by who is asking, not by what happens: a member holds
 * no `users:write`, so their own portrait is written through
 * `/users/current/headshot`.
 */
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { myHeadshotUploadResponseSchema } from "../../../../../shared/schemas/me";
import type { AvatarStatus } from "../../../../ui/Avatar";
import { HeadshotTile } from "../../../../shared/headshot/HeadshotTile";
import { headshotBodyEndpoint } from "../../../../shared/headshot/endpoints";
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
  const endpoint = isSelf
    ? headshotBodyEndpoint(`${CURRENT_USER_API}/headshot`, myHeadshotUploadResponseSchema)
    : headshotBodyEndpoint(`/api/v1/users/${encodeURIComponent(userId)}/headshot`, successResponseSchema);
  return (
    <HeadshotTile
      status={status}
      name={displayName}
      canChange={canEdit}
      imageUrl={headshotUrl}
      // The record keeps the staff assertion for both readers, as it always has.
      consent="on-behalf"
      self={isSelf}
      endpoint={endpoint}
      onChanged={() => onChanged()}
      notify={toast}
    />
  );
}
