/** Read `<id> [--phone] [--dark]` into the page settings and output file name. */
export function parseShotArguments(argv) {
  const id = argv.find((argument) => !argument.startsWith("--"));
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error("Usage: pnpm gallery:shot <id> [--phone] [--dark]");
  const phone = argv.includes("--phone");
  const dark = argv.includes("--dark");
  const suffix = [phone && "phone", dark && "dark"].filter(Boolean).join("-");
  return {
    id,
    viewport: phone ? { width: 375, height: 700 } : { width: 1024, height: 640 },
    colorScheme: dark ? "dark" : "light",
    file: `${id}${suffix ? `-${suffix}` : ""}.png`,
  };
}
