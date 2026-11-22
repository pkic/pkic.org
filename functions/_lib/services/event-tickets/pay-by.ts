/**
 * The deadline of a ticket whose price changes: one that was already waiting keeps the deadline it had, so a change
 * of days or ticket does not buy more time; one that starts to wait now gets the bound value, and a ticket with
 * nothing to pay has none. The new deadline is bound twice.
 */
export const TICKET_PAY_BY_ON_CHANGE_SQL =
  "CASE WHEN ? IS NULL THEN NULL WHEN status = 'pending_payment' AND pay_by IS NOT NULL THEN pay_by ELSE ? END";
