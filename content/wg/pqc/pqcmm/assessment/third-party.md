---
date: 2026-05-07T00:00:00Z
linkTitle: "Third-Party Assessment"
title: "Third-Party Assessment - PQC Maturity Model (PQCMM)"
description: A third-party PQCMM assessment is an independent, evidence-based evaluation of a product's PQC maturity level, performed by an accredited assessor and resulting in a formal report.
summary: An accredited independent assessor evaluates the product against PQCMM criteria, reviews evidence, and produces a formal assessment report — suitable for customer-facing disclosure and as the basis for PKI Consortium certification.
weight: 20
---

## What Is a Third-Party Assessment?

A third-party assessment is an independent evaluation of a product's PQCMM maturity level, conducted by an assessor with no stake in the outcome. The assessor reviews evidence, interviews technical staff, and produces a formal written report attesting to the achieved level.

A third-party assessment provides significantly higher assurance than a [self-assessment](/wg/pqc/pqcmm/assessment/self-assessment/) because the level claim is validated by an independent party who has examined the evidence.

> Third-party assessment is a **prerequisite** for [PKI Consortium Certification](/wg/pqc/pqcmm/assessment/certification/). The PKI Consortium reviews the third-party report as part of the certification process and does not conduct its own technical assessment.
{.callout-info}

## Who Can Perform a Third-Party Assessment?

The PKI Consortium is developing an **assessor accreditation programme** for PQCMM. Once established, only accredited assessors will be eligible to produce reports that are accepted for certification purposes. The starting accreditation criteria are described on the [Accredited Assessors](/wg/pqc/pqcmm/assessment/assessors/) page.

In the meantime, PQCMM third-party assessments are best performed by organisations with demonstrated capability in:

- **Post-quantum cryptography review** — practical familiarity with the algorithms, parameter sets, and standards bodies the model references.
- **Cryptographic implementation and standards-conformance assessment** — verifying that an implementation behaves as the relevant specification requires.
- **Security audit** — applying an independent, evidence-based methodology and producing a defensible written opinion.
- **Interoperability and, where the product's use cases warrant it, performance evaluation.**

Organisation type (consultancy, audit firm, laboratory, in-house assessment group) is not what determines suitability; demonstrated capability against the criteria above is. Organisations seeking assessors are encouraged to contact the PKI Consortium at contact at pkic dot org for guidance.

### Independence

A third-party assessment is only credible if the assessor is genuinely independent of the vendor. For PQCMM purposes, an assessor is independent when **all** of the following are true:

- The assessor is a separate legal entity from the vendor.
- The assessor has no ownership interest in, and is not owned or controlled by, the vendor.
- The assessor has no financial interest in the assessed product beyond the assessment fee.
- The assessor has no undisclosed conflict of interest with the vendor ([see Glossary](/wg/pqc/pqcmm/glossary/)).
- The assessor's declaration of independence is signed by the assessor (not the vendor) and included in the report.

Any conflict of interest — including current or recent consulting engagements with the vendor relating to the assessed product, board or advisory positions, or revenue dependency — must be disclosed in the assessment report. Undisclosed conflicts identified after the fact are grounds for the PKI Consortium to refuse, suspend, or revoke certification.

### Prior Engagement Disclosure

To prevent assessor shopping, the assessor must ask the vendor whether the product has been the subject of a prior PQCMM engagement (whether completed, abandoned, or in progress) with any other assessor. The vendor must answer truthfully. The assessor records the answer in the report and includes it in any certification application. Failing to disclose a prior engagement is grounds for the PKI Consortium to refuse or revoke certification. A vendor remains free to switch assessors; the obligation is to disclose, not to remain with one assessor.

## Assessment Process

### 1. Scoping

Define the precise scope of the assessment:

- Which product or service is being assessed (name, version, release channel)?
- Which deployment scenarios are in scope (cloud, on-premises, embedded, etc.)?
- Which cryptographic features are in scope (TLS, code signing, key exchange, certificates)?

### 2. Evidence Collection

The vendor provides evidence supporting each PQCMM criterion. Evidence typically includes:

- Product documentation and release notes confirming algorithm support.
- Configuration guides demonstrating how quantum-safe algorithms are enabled.
- SBOM or cryptographic inventory exports.
- Roadmap documentation (for criteria related to planned capabilities).
- FIPS 140 validation certificates or audit reports (for [Level 5](/wg/pqc/pqcmm/levels/5-optimized/)).

### 3. Technical Review

The assessor independently reviews the evidence and, where appropriate:

- Tests the product in a lab environment to verify algorithm availability.
- Interviews engineers or product managers to clarify ambiguous evidence.
- Checks algorithm implementations against NIST FIPS 203/204/205 specifications.
- Reviews SBOM/CBOM artefacts for completeness and accuracy.

### 4. Level Determination

The assessor evaluates each level's criteria in sequence. The assessed PQCMM level is the highest level where **all criteria are fully met** based on reviewed evidence.

### 5. Reporting

The assessor produces a formal written report containing:

- Executive summary with the assessed level and rationale.
- Detailed findings for each criterion assessed, including evidence references.
- Identification of any criteria that were partially met (gap analysis for the next level).
- Product identifiers for the assessed version, including the Common Platform Enumeration (CPE) identifier where one exists and any Package URL (purl), recorded as supplied by the vendor (see [Certification — Product Identifiers](/wg/pqc/pqcmm/assessment/certification/#product-identifiers)).
- Assessor's declaration of independence.
- Report date and version of the PQCMM specification used.

Where the report is intended to support a [certification](/wg/pqc/pqcmm/assessment/certification/) application, it must also be accompanied by the vendor's [senior-executive attestation](/wg/pqc/pqcmm/assessment/certification/#senior-executive-attestation). Vendors are encouraged to provide the same attestation alongside a third-party report submitted directly to customers; without it, the report carries only the assessor's signature and the vendor's evidence warranty.

## Using the Report

A third-party assessment report can be:

- Shared with customers, regulators, or procurement teams as evidence of PQC maturity.
- Submitted to the PKI Consortium as the basis for [certification](/wg/pqc/pqcmm/assessment/certification/).
- Referenced in tender responses, RFP submissions, and security questionnaires.

