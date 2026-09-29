/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const AUTHORITY_FLOW = {
  id: "authority",
  title: "Authority — who may see and do what",
  purpose:
    "Every surface in the portal is drawn from the capacities and permissions the caller actually holds, and refused at the API if it is reached another way. This flow is the one where a passing test proves an absence: the control that is not there, the stage change that is offered to nobody.",
  personas: ["participant", "direct chair", "inherited manager", "staff", "read-only staff", "anonymous"],
  steps: [
    {
      id: "9.1",
      title: "Personas resolve against real Worker and D1 sessions",
      status: "covered",
      note: "Member, inherited, local-only, staff and anonymous, resolved by the real session code rather than by a fixture asserting what it already assumed.",
    },
    {
      id: "9.2",
      title: "A participant sees collaboration sections and no management sections",
      status: "covered",
    },
    {
      id: "9.3",
      title: "A direct chair sees the complete group management surface",
      status: "covered",
    },
    {
      id: "9.4",
      title: "An inherited manager gets the same surface through the parent group",
      status: "covered",
      note: "Governance inherits down the lineage, so the chair of a parent manages a child without a second grant.",
    },
    {
      id: "9.5",
      title: "A local-only child's participant sees no management controls",
      status: "covered",
      note: "The counterpart to inheritance: a group set to local_only stops it, and that is a setting somebody chose.",
    },
    {
      id: "9.6",
      title: "A staff-only manager enters the portal without member navigation",
      status: "covered",
      note: "Staff capacity is not membership. Showing member navigation to staff would invite them to act as a member they are not.",
    },
    {
      id: "9.7",
      title: "An unauthorized identity stays on the sign-in screen and renders no group",
      status: "covered",
    },
    {
      id: "9.8",
      title: "Enfranchisement follows the bylaws: an interested party votes nowhere",
      status: "covered",
      note: "The category decides the franchise, and the bylaws decide the category. This is the step that keeps a product change from quietly enfranchising a class of member.",
    },
    {
      id: "9.9",
      title: "A read-only staff persona reads applications and cannot change one",
      status: "covered",
    },
    {
      id: "9.10",
      title: "A permission reads without granting the next act: read cannot stage, write cannot approve",
      status: "covered",
      note: "Approval is the act that provisions a member, so it is separated from the permission that moves an application along.",
    },
    {
      id: "9.11",
      title: "Staff manage a custom role, and grant and revoke a permission",
      status: "covered",
      note: "Revoking is walked as well as granting: a grant that cannot be taken back is not a grant, it is a promotion.",
    },
    {
      id: "9.12",
      title: "A revoked permission stops working on the session that is already open",
      status: "unit",
      note: "There is no window, and the design is not the one it was assumed to be. The session token proves identity — subject, session, expiry — and carries no permissions: grants are computed from D1 on the request that uses them, so revocation lands immediately on a token already in use. Covered in admin-donations. The tempting optimization is the opposite one, putting the grants in the token to save the read, and it would buy that saving with a window in which a revoked permission still works. Staff capacity separately expires after eight hours, which shortens elevation rather than delaying revocation.",
    },
  ],
};
