import { lazy, Suspense } from "preact/compat";
import { useDialogQueryState } from "../../hooks/useDialogQueryState";
import { Button } from "../../ui/Button";
import { Spinner } from "../Spinner";

const InviteColleagueDialog = lazy(() =>
  import("./RegistrationInviteForm").then((module) => ({
    default: module.InviteColleagueDialog,
  })),
);

/** The session-based invitation entry point on Share & Invite. */
export function InviteColleagueButton({ eventSlug }: { eventSlug: string }) {
  const [inviting, showInvitation, closeInvitation] = useDialogQueryState("inviteColleague");
  return (
    <>
      <Button onClick={showInvitation}>Invite a colleague</Button>
      {inviting && (
        <Suspense fallback={<Spinner label="Loading invitation form…" />}>
          <InviteColleagueDialog eventSlug={eventSlug} onClose={() => void closeInvitation()} />
        </Suspense>
      )}
    </>
  );
}
