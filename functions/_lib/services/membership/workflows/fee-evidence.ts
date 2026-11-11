/** Any fee in this generation prevents reusing its review for a category correction.
 * Callers alias the pinned workflow as `workflow`, including commit-time guards.
 */
export const MEMBERSHIP_WORKFLOW_HAS_FEE_SQL = `EXISTS (SELECT 1 FROM membership_fee_intents fee
  WHERE fee.application_id = workflow.application_id AND fee.generation = workflow.generation)`;
