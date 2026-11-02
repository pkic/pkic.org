import { personDisplayNameSql } from "../people/person-name-sql";

/** Canonical agenda credit display expression; the caller joins users as user. */
export const agendaSpeakerDisplayNameSql = personDisplayNameSql("user", "Speaker");
