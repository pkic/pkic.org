/** Styles required at first paint, including static wrapper/shared imports. Lazy styles stay lazy. */
export function entryStylesheets(entryFileName, bundle) {
  const seen = new Set();
  const styles = new Set();
  function visit(fileName) {
    if (seen.has(fileName)) return;
    seen.add(fileName);
    const chunk = bundle[fileName];
    if (chunk?.type !== "chunk") return;
    for (const imported of chunk.imports) visit(imported);
    for (const stylesheet of chunk.viteMetadata?.importedCss ?? []) styles.add(stylesheet);
  }
  visit(entryFileName);
  return [...styles];
}
