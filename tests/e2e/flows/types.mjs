/**
 * The shape a flow declaration takes.
 *
 * `status` is a statement about coverage, never permission to skip:
 *   - "covered"  a spec walks this step
 *   - "unit"     the behaviour is tested below the browser only
 *   - "gap"      nothing tests it
 *   - "absent"   the product does not do this yet
 *
 * Keeping "gap" and "absent" apart matters. A gap is work; an absent step is a
 * decision, and reading one as the other is how a missing feature turns into a
 * missing test nobody writes.
 *
 * @typedef {"covered" | "unit" | "gap" | "absent"} StepStatus
 *
 * @typedef {object} Step
 * @property {string} id
 * @property {string} title  What a person does, or what the system must do in
 *   response — not a test name, and not a route.
 * @property {StepStatus} status
 * @property {string} [note] Why the status is what it is: what a "unit" step is
 *   covered by instead, or what a "gap" would catch if somebody walked it.
 *
 * @typedef {object} Flow
 * @property {string} id
 * @property {string} title
 * @property {string} purpose
 * @property {string[]} personas
 * @property {Step[]} steps
 */

export {};
