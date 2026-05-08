---
date: 2026-05-07T00:00:00Z
linkTitle: "Vendor Survey"
title: "Vendor Assessment Survey - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: How to require vendors to submit a Post-Quantum Cryptography Maturity Model assessment or certification report, including mandatory intake questions, existing supply chain evaluations, evidence expectations, and red flags.
summary: Use this standardized question set in your procurement tenders and supply chain surveys to require vendors to state and support their PQCMM level for both new contracts and existing inventory.
weight: 10
---

## Assessing Your Entire Supply Chain

Organizations implementing post-quantum cryptography must evaluate not only new acquisitions, but their **existing contracted supply chain**—the products and services already integrated into their operations. This vendor assessment survey is designed for both procurement (new contracts) and existing vendor governance (renewals, supply chain risk management).

Almost any product today is digitally connected. Even physical offline products often use cryptography and could be compromised through firmware updates. Make this survey the default for your entire downstream supply chain.

> Assessing existing vendors establishes a baseline for your supply chain risk. If a critical vendor is at [Level 0](/wg/pqc/pqcmm/levels/0-none/), that is not an immediate failure, but a risk that must be recorded, tracked, and remediated in subsequent milestones.
{.callout-info}

## Principle

The vendor assessment survey should be centred on the Post-Quantum Cryptography Maturity Model (PQCMM) itself. Do not ask a long list of disconnected cryptography questions and then infer a level yourself. Require the vendor to submit a PQCMM assessment or certification report for the product or service in scope.

The assessment report is the deliverable. The individual criteria and evidence are used to verify the report.

This makes the process easier for buyers: instead of asking procurement teams to interpret cryptographic implementation details, the vendor must declare a level, state the assurance method, and map evidence to the model.

## Mandatory Intake Questions

Use these questions in supplier questionnaires, requests for proposal, tenders, renewals, and due-diligence evaluations of your existing deployment base:

| # | Question | Required answer |
|-----|---|-----|
| 1 | What product or service is in scope? | Product/service name, version, edition, deployment model, and assessed configuration |
| 2 | What PQCMM level is claimed for this product or service? | [Level 0](/wg/pqc/pqcmm/levels/0-none/), [Level 1](/wg/pqc/pqcmm/levels/1-initial/), [Level 2](/wg/pqc/pqcmm/levels/2-basic/), [Level 3](/wg/pqc/pqcmm/levels/3-advanced/), [Level 4](/wg/pqc/pqcmm/levels/4-managed/), or [Level 5](/wg/pqc/pqcmm/levels/5-optimized/) |
| 3 | What assurance method supports the claim? | Self-assessed, third-party assessed, or PKI Consortium certified |
| 4 | Provide the PQCMM assessment or certification report. | Report title, date, report version, assessor or certifier, certificate identifier if applicable |
| 5 | Does the report cover the exact product, version, deployment model, and configuration offered or actively deployed in this organization? | Yes/No, with explanation for any mismatch |
| 6 | Does the report confirm that all criteria for the claimed level and all lower levels are met? | Yes/No, with a criteria-by-criteria evidence matrix |
| 7 | Are you explicitly assessing your own downstream suppliers using the PQCMM or an equivalent standard? | Yes/No, detailing the primary assessment framework |
| 8 | What evidence supports the claim? | Documentation links, release notes, software bill of materials (SBOM), cryptographic bill of materials (CBOM), validation results, test reports, or configuration guides |
| 9 | What criteria at the next level are partially met or planned? | Gap list, target dates, dependencies, and accountable owner |
| 10 | What events require reassessment? | Major version changes, cryptographic library changes, algorithm changes, deployment mode changes, or security incidents |
| 11 | If independent assurance is required by the buyer, will the vendor support third-party assessment or PKI Consortium certification? | Yes/No, with proposed timeline |

[Download the PQCMM Scorecard Template](pqcmm-scorecard-template.csv) to import these gating questions directly into your procurement and GRC tools.

These questions are not optional if the PQCMM is being used as a procurement control. If the organization has made PKI Consortium certification a precondition, question 3 must be answered "PKI Consortium certified" and question 4 must include the certificate or certificate reference.

## Minimum Report Metadata

Do not accept an assessment report unless it clearly states:

| Metadata | Why it matters |
|---|-----|
| Product or service name | Prevents organization-level claims from being treated as product evidence |
| Version, edition, deployment model, and configuration | Confirms the report covers what is being bought |
| Claimed PQCMM level | Provides the maturity claim being evaluated |
| Assessment method | Separates self-assessed, third-party assessed, and certified claims |
| Assessment date and report version | Supports recency checks and reassessment policy |
| Assessor or certifier identity, where applicable | Supports reliance on independent assurance |
| PQCMM version used | Ensures criteria are interpreted against a known version of the model |
| Evidence availability and confidentiality status | Helps procurement teams plan review access and retention |

## Procurement Clause

Use or adapt this language:

> *For each product or service in scope, the supplier shall provide a Post-Quantum Cryptography Maturity Model (PQCMM) assessment or certification report. The response must state the claimed PQCMM level, the assurance method (self-assessed, third-party assessed, or PKI Consortium certified), the assessment date, the assessor or certifier where applicable, and evidence supporting each criterion for the claimed level and all lower levels. Claims not supported by evidence may be treated as non-responsive or scored as unverified.*

If certification is mandatory:

> *PKI Consortium Post-Quantum Cryptography Maturity Model (PQCMM) certification at Level [X] or higher is a mandatory condition of award. Self-assessment or third-party assessment may be submitted for context but will not satisfy this requirement unless accompanied by a valid certificate covering the product, version, deployment model, and configuration offered.*

## Required Evidence Package

Ask vendors to attach or reference an evidence package. The contents will depend on the claimed level, but commonly include:

| Evidence | Why it matters |
|---|---|
| PQCMM assessment or certification report | Primary artefact for the claimed level and assurance method |
| Criteria evidence matrix | Shows each requirement is met, not just the headline level |
| Product documentation and configuration guides | Confirms customers can use the claimed capability |
| Release notes or changelog | Confirms the feature exists in the assessed version |
| Algorithm and parameter-set list | Prevents vague claims such as "supports PQC" |
| Software bill of materials and cryptographic bill of materials, where required by the level | Supports inventory, risk analysis, and crypto agility evaluation |
| Interoperability, validation, or benchmark results | Supports implementation quality and operational readiness |
| Roadmap and remediation plan | Explains gaps to the next level and timing of planned improvements |

## Evidence Matrix Template

Ask vendors to provide a matrix like this. It keeps the response focused on the model and makes review much faster.

| Field | Vendor response |
|---|---|
| Product/service and version |  |
| Claimed level |  |
| Assessment method | Self-assessed / third-party assessed / PKI Consortium certified |
| Report title and date |  |
| PQCMM version used |  |
| Criterion reference | Level and criterion number or heading |
| Vendor answer | Met / Not met / Not applicable, with justification |
| Evidence reference | URL, document name, report section, file reference, or data-room location |
| Evidence owner | Vendor contact responsible for the evidence |
| Confidentiality status | Public / NDA / secure portal / redacted / assessor-only |
| Buyer review result | Accepted / clarification needed / rejected |

For a procurement team, the most useful matrix is boring and explicit: one row per criterion, one evidence reference per claim, and no marketing-only entries.

## Acceptance Checks

Before accepting a response, verify:

- The report covers the product or service you are buying, not a different product line.
- The report covers the version, edition, deployment model, and configuration in the proposal.
- The claimed level is cumulative: all lower-level criteria are also met.
- Evidence is current enough for the procurement decision and has not been superseded by a major release.
- Any self-assessed claim is clearly labelled as self-assessed.
- Any third-party report identifies the assessor and assessment scope.
- Any certified claim includes the certificate reference and validity period.

## Red Flags

Treat the following as reasons to seek clarification, lower the score, require remediation, or reject the response:

- Vendor claims a level but refuses to provide an assessment or certification report.
- Vendor provides marketing material instead of criteria-level evidence.
- Report scope does not match the product or version being procured.
- Vendor claims Level 3 or higher but cannot provide software bill of materials, cryptographic bill of materials, or equivalent cryptographic inventory evidence where required.
- Vendor claims production readiness but the feature is beta, preview, undocumented, or only available through custom builds.
- Vendor claims independent validation but does not identify the assessor, certifier, report date, or scope.
- Vendor claims "partial Level 4" as though it were a PQCMM level. Partial progress is useful roadmap evidence, but the assessed level remains the highest fully met level.

## Handling Confidential Evidence

Assessment reports, software bills of materials, and cryptographic bills of materials may contain sensitive implementation details. Procurement teams should define how evidence will be protected, who may access it, how long it will be retained, and whether a redacted executive summary is acceptable for early-stage evaluation.

Use a simple handling rule:

| Evidence sensitivity | Practical handling approach |
|---|---|
| Public documentation | Link in the response and record access date |
| Customer documentation | Store in the procurement or vendor-risk record |
| Sensitive software bill of materials, cryptographic bill of materials, or architecture evidence | Share under non-disclosure agreement through a secure portal or data room |
| Highly sensitive implementation evidence | Permit assessor-only review and require the assessment report to summarize conclusions |

The buyer still needs enough detail to verify the claimed level. If evidence cannot be shared directly, independent assessment becomes more important.

