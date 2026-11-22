/**
 * The bio of the identity a person applies as, on the membership application.
 * The application needs one, so it is shown, or asked for, before the person
 * submits, and edited in place in the identity's own profile editor.
 */
import { useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { useData } from "../hooks/useData";
import { getJson } from "../shared/api-client";
import { ownIdentityProfileSchema } from "../../shared/schemas/own-identity-profile";
import { OwnIdentityProfileEditor, ownIdentityProfilePath } from "../components/identities/OwnIdentityProfileEditor";
import { IconPencil } from "../components/icons";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/** Long enough to recognize the bio, short enough to keep the summary to a line or two. */
const PREVIEW_LENGTH = 140;

function preview(biography: string): string {
  return biography.length > PREVIEW_LENGTH ? `${biography.slice(0, PREVIEW_LENGTH).trimEnd()}…` : biography;
}

export function JoinApplicantBio({ identityId }: { identityId: string }) {
  const [editing, setEditing] = useState(false);
  const { data, reload } = useData(
    () => getJson(ownIdentityProfilePath(identityId), ownIdentityProfileSchema),
    [identityId],
  );
  const biography = data?.biography?.trim() ?? "";
  const action = biography ? "Edit bio" : "Add bio";
  return (
    <>
      <span class="pk-cluster pk-cluster--nowrap">
        <span class={biography ? undefined : "pk-muted"} data-join-applicant-bio>
          {data ? (biography ? preview(biography) : "Add a bio to apply") : "…"}
        </span>
        {data && (
          <Button
            type="button"
            variant="ghost"
            icon
            aria-label={action}
            title={action}
            onClick={() => setEditing(true)}
          >
            <IconPencil />
          </Button>
        )}
      </span>
      {editing &&
        createPortal(
          <Dialog
            open
            viewer
            title={action}
            closeLabel="Close bio"
            confirmLabel="Close"
            onConfirm={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          >
            <div class="pk-stack" onSubmit={(event) => event.stopPropagation()}>
              <OwnIdentityProfileEditor
                identityId={identityId}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  void reload();
                }}
              />
            </div>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
