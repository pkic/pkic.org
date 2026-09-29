import fs from "node:fs";
import path from "node:path";
import { unstable_splitSqlQuery } from "wrangler";

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error("Usage: node scripts/reorder-d1-dump.mjs <path-to-sql-dump>");
  process.exit(1);
}

// `wrangler d1 export` interleaves each table's CREATE TABLE with its own
// INSERTs, in table-creation order. A table created later (e.g. `users`) can
// still be the target of a FOREIGN KEY on a table created earlier (e.g.
// `organizations.primary_contact_user_id`), so replaying the dump as-is can
// fail with "no such table" the moment a row with a non-null FK value is
// inserted before the referenced table exists. `PRAGMA defer_foreign_keys`
// (already present in every dump) only defers the row-existence check to
// commit time — it can't help when the referenced table doesn't exist yet.
// Moving every CREATE statement ahead of all INSERTs (order preserved within
// each group) fixes this: by the time any row is inserted, every table
// already exists, so the deferred FK checks only need to resolve at commit.
const sql = fs.readFileSync(inputPath, "utf8");
const statements = unstable_splitSqlQuery(sql);

const pragmas = [];
const schema = [];
const data = [];

for (const statement of statements) {
  const trimmed = statement.trimStart();
  if (/^PRAGMA/i.test(trimmed)) {
    pragmas.push(statement);
  } else if (/^CREATE\s+(TABLE|(UNIQUE\s+)?INDEX|VIEW|TRIGGER)/i.test(trimmed)) {
    schema.push(statement);
  } else {
    data.push(statement);
  }
}

const tmpPath = `${inputPath}.tmp`;
const out = fs.createWriteStream(tmpPath);
for (const statement of [...pragmas, ...schema, ...data]) {
  out.write(statement);
  out.write(";\n");
}
await new Promise((resolve, reject) => {
  out.end((err) => (err ? reject(err) : resolve()));
});
fs.renameSync(tmpPath, inputPath);

console.log(
  `Reordered ${statements.length} statement(s) in ${path.relative(process.cwd(), inputPath)} ` +
    `(${pragmas.length} pragma, ${schema.length} schema, ${data.length} data) so schema precedes data.`,
);
