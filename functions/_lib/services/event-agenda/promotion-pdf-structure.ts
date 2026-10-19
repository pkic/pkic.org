import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
  PDFString,
  type PDFPage,
} from "pdf-lib";

/** Logical reading order for promotion PDFs, independently of drawing coordinates. */
export function promotionPdfStructure(pdf: PDFDocument) {
  const context = pdf.context;
  const root = context.obj({ Type: "StructTreeRoot", K: [] });
  const rootRef = context.register(root);
  const document = context.obj({ Type: "StructElem", S: "Document", P: rootRef, K: [] });
  const documentRef = context.register(document);
  root.lookup(PDFName.of("K"), PDFArray).push(documentRef);
  pdf.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  pdf.catalog.set(PDFName.of("MarkInfo"), context.obj({ Marked: true }));
  pdf.catalog.set(PDFName.of("ViewerPreferences"), context.obj({ DisplayDocTitle: true }));
  const parents = context.obj([]);
  let nextKey = 0;
  const append = (parent: PDFDict, child: PDFRef | PDFDict | PDFNumber) =>
    parent.lookup(PDFName.of("K"), PDFArray).push(child);
  const element = (role: string, parent: PDFDict, page: PDFPage, alt?: string) => {
    const node = context.obj({ Type: "StructElem", S: role, P: context.getObjectRef(parent)!, Pg: page.ref, K: [] });
    if (alt) node.set(PDFName.of("Alt"), PDFString.of(alt));
    const ref = context.register(node);
    append(parent, ref);
    return node;
  };
  return {
    page(page: PDFPage) {
      const key = nextKey++;
      const section = element("Sect", document, page);
      const pageParents = context.obj([]);
      parents.push(PDFNumber.of(key));
      parents.push(pageParents);
      page.node.set(PDFName.of("StructParents"), PDFNumber.of(key));
      let mcid = 0;
      return {
        element: (role: string, parent = section, alt?: string) => element(role, parent, page, alt),
        content(node: PDFDict, draw: () => void) {
          const id = mcid++;
          pageParents.push(context.getObjectRef(node)!);
          append(node, context.obj({ Type: "MCR", Pg: page.ref, MCID: id }));
          page.pushOperators(
            PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
              node.lookup(PDFName.of("S"), PDFName),
              context.obj({ MCID: id }).toString(),
            ]),
          );
          draw();
          page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
        },
        artifact(draw: () => void) {
          page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of("Artifact")]));
          draw();
          page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
        },
        annotation(node: PDFDict, ref: PDFRef) {
          const annotationKey = nextKey++;
          context.lookup(ref, PDFDict).set(PDFName.of("StructParent"), PDFNumber.of(annotationKey));
          parents.push(PDFNumber.of(annotationKey));
          parents.push(context.getObjectRef(node)!);
          append(node, context.obj({ Type: "OBJR", Obj: ref, Pg: page.ref }));
        },
      };
    },
    finish() {
      root.set(PDFName.of("ParentTree"), context.register(context.obj({ Nums: parents })));
      root.set(PDFName.of("ParentTreeNextKey"), PDFNumber.of(nextKey));
    },
  };
}
