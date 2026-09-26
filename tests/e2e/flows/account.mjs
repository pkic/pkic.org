/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const ACCOUNT_FLOW = {
  id: "account",
  title: "Account — signing in, and the capacity you act in",
  purpose:
    "Somebody proves who they are, the session that follows carries exactly the capacities they hold, and it ends when they say so. One identity may act for more than one Member, and which one is selected changes what the rest of the portal will do.",
  personas: ["member", "staff", "person representing two organizations", "somebody with no access"],
  steps: [
    {
      id: "7.1",
      title: "An emailed link signs a person in and returns them where they started",
      status: "covered",
      note: "The route the sign-in interrupted rides along with the link, so somebody who came to join a working group lands back on it rather than on the portal's front page.",
    },
    {
      id: "7.2",
      title: "A sign-in link is single use and cannot be replayed",
      status: "covered",
    },
    {
      id: "7.3",
      title: "The capability leaves the address bar and is not left in history",
      status: "covered",
      note: "A link that survives in history is a credential lying in the open on a shared machine.",
    },
    {
      id: "7.4",
      title: "Signing out revokes the session rather than only clearing the view",
      status: "covered",
      note: "The distinction is the whole point: a cleared view with a live session is a session an attacker can still use.",
    },
    {
      id: "7.5",
      title: "A membership join capability cannot be redeemed as a portal sign-in",
      status: "covered",
      note: "Two capabilities travel by email and only one of them is an identity. Confusing them would let an invitation become a session.",
    },
    {
      id: "7.6",
      title: "An approved applicant can sign in; an unknown address creates no session",
      status: "covered",
      note: "The unknown address still gets the same answer on screen — the flow is enumeration-safe — and creates nothing behind it.",
    },
    {
      id: "7.7",
      title: "A passkey is registered, used to sign in, and removed",
      status: "covered",
      note: "Driven through a real WebAuthn ceremony against a virtual authenticator, so the browser's own calls are exercised rather than mocked.",
    },
    {
      id: "7.8",
      title: "A passkey is offered without prompting after a sign-in that used a link",
      status: "unit",
      note: "Conditional create asks the platform to make a passkey only if it judges the moment right, and it shows the reader nothing either way — there is no browser-visible step to walk. Covered by passkey-automatic-upgrade: the capability check, the useAutoRegister call, and silence on every refusal the platform is expected to give.",
    },
    {
      id: "7.9",
      title: "A person representing two organizations switches between both capacities",
      status: "covered",
      note: "And a membership the caller does not hold cannot be selected, which is the half that matters: the selector is an authorization boundary, not a preference.",
    },
    {
      id: "7.10",
      title: "Notification preferences persist, and the access summary names what the identity holds",
      status: "covered",
    },
  ],
};
