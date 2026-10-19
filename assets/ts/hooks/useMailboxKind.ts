import {
  emailDomainOf,
  emailDomainResponseSchema,
  emailDomainUrl,
  type MailboxKind,
} from "../../shared/schemas/email-domains";
import { getJson } from "../shared/api-client";
import { useData } from "./useData";

/**
 * What kind of mailbox an address is, as the server's lists say; the browser
 * never carries them. Null while unknown, for no address, or when the server
 * cannot answer — callers treat that as "no reason to say anything".
 */
export function useMailboxKind(email: string | null | undefined): MailboxKind | null {
  const domain = email ? emailDomainOf(email) : "";
  const { data } = useData(
    () =>
      domain
        ? getJson(emailDomainUrl(domain), emailDomainResponseSchema).then((answer) => answer.kind)
        : Promise.resolve(null),
    [domain],
  );
  return data;
}
