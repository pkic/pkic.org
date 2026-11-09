import { lazy, Suspense } from "preact/compat";
import { useDialogQueryState } from "../../hooks/useDialogQueryState";
import { Button } from "../../ui/Button";
import { Spinner } from "../Spinner";

const InviteColleagueDialog = lazy(() =>
  import("./RegistrationInviteForm").then((module) => ({
    default: module.InviteColleagueDialog,
  })),
);

/** One invitation entry point shared by the event home and Share & Invite. */
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
