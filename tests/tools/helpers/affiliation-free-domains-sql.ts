/**
 * The statements migration 0038 loads its free-domain working table with,
 * rendered from the Worker's email-domain classification. D1 refuses a
 * statement over 100,000 bytes, so the set is split into JSON arrays that each
 * keep a statement well below that.
 */
import { affiliationFreeEmailDomains } from "../../../functions/_lib/email-domains/classification";

export const D1_STATEMENT_MAX_BYTES = 100_000;
const CHUNK_BUDGET_BYTES = 90_000;

export function affiliationFreeEmailDomainsSql(domains: readonly string[] = affiliationFreeEmailDomains()): string {
  const statements: string[] = [];
  let chunk: string[] = [];
  let bytes = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    statements.push(
      `INSERT INTO affiliation_free_email_domains (domain) SELECT value FROM json_each('${JSON.stringify(chunk)}');`,
    );
    chunk = [];
    bytes = 0;
  };
  for (const domain of domains) {
    if (bytes + domain.length + 3 > CHUNK_BUDGET_BYTES) flush();
    chunk.push(domain);
    bytes += domain.length + 3;
  }
  flush();
  return statements.join("\n");
}
