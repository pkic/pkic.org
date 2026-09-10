/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const SPONSOR_FLOW = {
  id: "sponsor",
  title: "Sponsorship — inquiry to sponsor workspace",
  purpose:
    "An organization offers to sponsor the consortium or one of its events; staff turn that into a sponsorship, and the sponsor gets a workspace and a place on the wall.",
  personas: ["prospective sponsor", "staff", "sponsor contact"],
  steps: [
    { id: "2.1", title: "Submit a generic consortium sponsor inquiry against the configured tiers", status: "covered" },
    { id: "2.2", title: "Submit an inquiry for a named tier on a specific event", status: "covered" },
    {
      id: "2.3",
      title: "Staff turn an inquiry into a sponsorship and advance it through the pipeline",
      status: "covered",
      note: "The stage advance and its history are walked in portal-management-verification.",
    },
    {
      id: "2.4",
      title: "A sponsor contact reaches their workspace through a mailbox link",
      status: "covered",
    },
    { id: "2.5", title: "The sponsor appears on the wall, paged", status: "covered" },
    {
      id: "2.3.a",
      title: "Staff correct a sponsorship's tier, contact and name after it was entered",
      status: "covered",
      note: "An inquiry arrives with whatever the sender typed, and only the fields the pipeline's own automation needed could be corrected afterwards (#30). The tier is a select over the catalog rather than a box to spell a tier into; the record edit is walked in portal-management-verification alongside the stage move.",
    },
    {
      id: "2.3.b",
      title: "Record a company that decides against sponsoring",
      status: "covered",
      note: "not_proceeding is offered in the stage control and asserted in portal-management-verification; what it does — no organization sponsor projection, no renewal work scheduled, the reason kept on the record — is covered at the service in sponsorship-pipeline, because none of it is visible in a browser.",
    },
    {
      id: "2.6",
      title: "A withdrawn or unconfigured tier is refused rather than priced",
      status: "unit",
      note: 'This step used to say "full, withdrawn, or on a closed event". Two thirds of that describes a product that does not exist: tiers carry no capacity and no per-event availability, so nothing can be full. What does exist is `active` on the tier configuration, and it is the one that matters, because the row stays behind when a tier is withdrawn so that sponsorships already sold keep their price. A tier name that resolves to a row but must not resolve to a price is how somebody pays a figure no longer on offer. Covered at the route in sponsorship-checkout: 422 before any Stripe session, naming the tiers still available. Not walked in a browser because the public form only offers active tiers — reaching this needs a crafted request, which is the shape the guard exists for.',
    },
  ],
};
