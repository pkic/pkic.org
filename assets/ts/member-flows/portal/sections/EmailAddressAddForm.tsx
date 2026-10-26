/**
 * Adding an email address: a form of its own under the user record,
 * validated by the contract the route parses. The person's own address is
 * saved only after verification; requesting it sends a link. Staff add a
 * secondary address to another user's record. The way back is the record.
 */
import { EmailAddressCreateForm } from "../../../components/identities/EmailAddressCreateForm";
import { Breadcrumb } from "../../../ui/Breadcrumb";
import { ButtonLink } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { usePortalHashLocation } from "../hash-location";
import { toast } from "../ui";

export function EmailAddressAddForm({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const recordPath = `/users/${encodeURIComponent(userId)}`;
  const [, navigate] = usePortalHashLocation();
  return (
    <section class="pk pk-stack" aria-label="Add an email address">
      <Breadcrumb
        items={[
          isSelf
            ? { label: "My profile", href: usePortalHashLocation.hrefs(recordPath) }
            : { label: "Users", href: usePortalHashLocation.hrefs("/users") },
          ...(isSelf ? [] : [{ label: "User record", href: usePortalHashLocation.hrefs(recordPath) }]),
          { label: "Add an email address" },
        ]}
      />
      <Panel aria-label="Add an email address">
        <PanelHeader title="Add an email address" />
        <PanelBody>
          <EmailAddressCreateForm
            userId={userId}
            isSelf={isSelf}
            onAdded={(email) => {
              toast(isSelf ? `Check ${email} for the verification link` : `${email} added`, "success");
              navigate(recordPath);
            }}
            actions={
              <ButtonLink variant="ghost" href={usePortalHashLocation.hrefs(recordPath)}>
                Cancel
              </ButtonLink>
            }
          />
        </PanelBody>
      </Panel>
    </section>
  );
}
