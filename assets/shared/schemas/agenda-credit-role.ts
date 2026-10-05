import { z } from "zod";

export const agendaCreditRoleSchema = z.enum(["proposer", "speaker", "co_speaker", "moderator", "panelist"]);
