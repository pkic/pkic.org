import { realpath } from "node:fs/promises";
import { resolve, relative, dirname, basename, isAbsolute } from "node:path";

/** A local diagnostic receipt must never become a public source asset or be removed with staging. */
export async function localSnapshotReceiptPath(receipt, environment, protectedTrees) {
  if (!receipt) return undefined;
  if (environment !== "local") throw new Error("Snapshot receipts are local-only");
  const destination = resolve(await realpath(dirname(resolve(receipt))), basename(receipt));
  for (const tree of protectedTrees) {
    const fromTree = relative(await realpath(tree), destination);
    if (!fromTree || (!fromTree.startsWith("../") && !isAbsolute(fromTree)))
      throw new Error("Snapshot receipts must stay outside public source, output, and staging trees");
  }
  return destination;
}
