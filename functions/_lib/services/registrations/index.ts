// Barrel re-export – all implementation lives in focused single-responsibility modules.
export type { RegistrationRecord, VerifiedRegistrationIdentityContext } from "./types";
export { getRegistrationByManageToken, getRegistrationById, listRegistrationsForEvent } from "./queries";
export { createRegistration } from "./create";
export { confirmRegistrationByToken } from "./confirm";
export {
  updateRegistrationByManageToken,
  updateRegistrationByManageTokenWithNotification,
  updateRegistrationByManageTokenWithEmailChange,
  updateRegistrationById,
  updateRegistrationByIdWithNotification,
  updateRegistrationByIdWithEmailChange,
} from "./update";
export { forceRegistrationStatus } from "./force-status";
export { changeRegistrationEmail, finalizeEmailChange } from "./change-email";
export { admitRegistration } from "./admission";
export {
  admitGroupManagedEventRegistration,
  getGroupManagedEventRegistration,
  updateGroupManagedEventRegistrationDayAttendance,
} from "./group-attendee-management";
export { updateManagedRegistration } from "./manage-update";
