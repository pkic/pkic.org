# PQCMM Next-Version Issues

This backlog records possible improvements without changing the approved PQCMM Version 1.0.1 criteria or assessment questions. Each item requires working-group review before inclusion in a new model version.

| ID | Area | Current issue | Candidate improvement |
|---|---|---|---|
| PQCMM-NEXT-001 | Level boundary | A product with some PQC implementation can fail Level 0 because PQC is present and fail Level 1 because documentation or enablement criteria are missing. Version 1.0.1 does not name this state. | Define whether the report should say "no level established" or introduce another explicit treatment without weakening either level. |
| PQCMM-NEXT-002 | Traceability | The 22 normative criteria are not mapped to the 72 assessment and intake questions. Automated tools must keep the criterion decision explicit rather than infer it from unrelated question completion. | Add stable criterion-to-question mappings and identify which answers or evidence support each criterion. |
| PQCMM-NEXT-003 | Evidence semantics | Guidance describes required evidence in prose, so tools cannot reliably distinguish mandatory fields, repeatable records, URLs, dates, versions, and independent-verification flags. | Add typed evidence requirements while retaining human-readable guidance. |
| PQCMM-NEXT-004 | Evidence checklist | Checklist items are level summaries and have no stable links to criteria or questions. | Add machine-readable relationships from checklist items to the criteria and questions they summarize. |
| PQCMM-NEXT-005 | References | Standards and validation databases are embedded as URLs in guidance. This duplicates sources and makes updates harder to review. | Introduce a versioned references catalog with stable identifiers, titles, authorities, and URLs. |
| PQCMM-NEXT-006 | Terminology | Version 1.0.1 mixes US and UK spelling, including artifact/artefact, organization/organisation, license/licence, and optimized/optimised. | Select the approved editorial convention and normalize it only in a reviewed new release. |
| PQCMM-NEXT-007 | Evidence reuse | The model does not say whether one evidence artifact may support multiple criteria or how an assessor should record that relationship. | Define evidence reuse and require explicit many-to-many evidence links in the report format. |
| PQCMM-NEXT-008 | Version metadata | The site identifies 1.0.1 as a revision but does not provide a machine-readable release date or change classification in the model data. | Add release date, status, supersedes, and change-summary fields to the next schema version. |
