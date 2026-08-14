# PQCMM Assessment Architecture

## Model Differences

The PKI Maturity Model (PKIMM) and PQC Maturity Model (PQCMM) share level names, but they do not use the same assessment semantics.

| Concern | PKIMM | PQCMM |
|---|---|---|
| Subject | An organization's PKI operation | One named product or service and its deployment scope |
| Structure | Modules, categories, requirements, and category weights | Six product maturity levels with normative criteria and supporting assessment questions |
| Calculation | Weighted category and requirement maturity ratings | Gate model: every criterion at a positive level and every lower positive level must be met |
| Level 0 | Not part of the weighted positive maturity calculation | Mutually exclusive baseline declaration; both Level 0 criteria must be met, but evidence is not required |
| Partial progress | Contributes to detailed maturity calculations | Useful as a gap, but never establishes the level |
| Evidence | Notes and references can support detailed requirement ratings | Positive-level criteria require an evidence statement or attached evidence file |
| Scope | Categories and requirements can be marked not applicable | The named product or service is assessed as released; product components cannot be excluded to improve the result |

The assessment questions guide evidence collection. They do not silently add normative criteria or replace the assessor's explicit criterion decision.

## Canonical Model Source

The approved PQCMM model data is stored at `assets/data/pqcmm/pqcmm-model-<version>.yaml`. Hugo renders criteria, assessment questions, and evidence checklists from that file and publishes the same bytes at `/wg/pqc/pqcmm/data/` for assessment and GRC consumers.

The JSON Schema is stored beside the model. The assessment component bundles a release snapshot for offline use and accepts the canonical site URL through its `dataUrl` attribute when embedded on pkic.org.

## Version Policy

- Released model criteria and assessment questions are immutable.
- Corrections or substantive wording changes require a new model version, review, and approval.
- Stable criterion and question identifiers must not be reused for different meanings.
- Saved and exported assessments record the exact PQCMM data version.
- An assessment created for a different PQCMM version is not silently migrated. A future migration must be explicit and preserve the source record.
- Candidate improvements are recorded in `docs/pqcmm-next-version-issues.md` until a new version is approved.

## Report and Evidence Boundary

Assessment state and uploaded files stay in browser IndexedDB. Portable JSON exports include evidence bytes so they can be restored offline. PDF reports embed a JSON manifest plus each evidence file as a PDF attachment. The manifest records the model version, result, criterion and question responses, embedded filename, media type, byte size, and SHA-256 digest.
