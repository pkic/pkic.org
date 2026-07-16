import { execFileSync } from "node:child_process";

// Case-insensitive/normalization-insensitive filesystems (macOS APFS/HFS+,
// Windows) collapse paths that git treats as distinct, e.g. "Löw" written
// with a precomposed ö (NFC) vs. "o" + combining diaeresis (NFD), or two
// names differing only by case. Git happily tracks both; checkout on those
// filesystems silently drops one. Catch that here instead of at clone time.
const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
const files = output.split("\0").filter(Boolean);

const seen = new Map();
for (const file of files) {
  const key = file.normalize("NFC").toLowerCase();
  const group = seen.get(key);
  if (group) {
    group.push(file);
  } else {
    seen.set(key, [file]);
  }
}

const collisions = [...seen.values()].filter((group) => group.length > 1);

if (collisions.length > 0) {
  console.error(`Found ${collisions.length} filename collision group(s) that will break on case-insensitive filesystems (e.g. macOS):`);
  for (const group of collisions) {
    console.error("-");
    for (const file of group) {
      console.error(`    ${file}`);
    }
  }
  process.exit(1);
}

console.log(`No case/normalization filename collisions found across ${files.length} tracked files.`);
