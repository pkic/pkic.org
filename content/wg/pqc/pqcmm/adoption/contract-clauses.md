---
date: 2026-05-07T00:00:00Z
linkTitle: "Example Contract Clauses"
title: "Example Contract Clauses - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: Example contract clauses that organizations can adapt to require a PQCMM level, assurance method, reassessment, and remediation from suppliers.
summary: Drop-in example clauses for procurement, master service, and supply-chain contracts that reference the PQCMM. These are illustrative starting points, not legal advice.
weight: 25
version: "0.1.0"
---

## Status and Disclaimer

> These clauses are **illustrative examples only**. They are intended as a starting point for legal and procurement teams adapting them to their own jurisdiction, contract framework, and risk tolerance. The PKI Consortium accepts **no liability** for the use of these examples and they do **not** constitute legal advice. Have qualified legal counsel review any clause before incorporating it into a binding contract.
{.callout-warning}

This page is at version **{{< param version >}}**. Changes are tracked in the [PQCMM version history](/wg/pqc/pqcmm/version-history/).

## How to Use These Clauses

The clauses below are written as building blocks. A typical procurement contract referencing the PQCMM combines:

1. A definitions clause that pins the PQCMM version.
2. A representation of the current PQCMM level and assurance method at award.
3. An obligation to maintain or improve the level over time.
4. A notification obligation for material changes.
5. A right to require an updated assessment, with the cost allocation specified.
6. Remedies on regression or loss of certification.

Bracketed text such as `[Supplier]`, `[Level X]`, `[N days]` should be replaced with the appropriate values.

## Clause Library

### 1. Definitions

> *"PQCMM" means the Post-Quantum Cryptography Maturity Model published by the PKI Consortium at https://pkic.org/wg/pqc/pqcmm/, version [X.Y.Z] as in effect on [the Effective Date / the date of this Agreement]. "PQCMM Level" means a level (0–5) defined in the PQCMM. "Third-Party Assessment" and "PKI Consortium Certification" have the meanings given to them in the PQCMM.*

### 2. Representation at Award

> *[Supplier] represents that, as of the Effective Date, the [Product/Service] meets PQCMM **Level [X]**, evidenced by a [self-assessment / third-party assessment report / current PKI Consortium PQCMM Certificate] dated no earlier than [N] months before the Effective Date. [Supplier] shall provide the assessment report and supporting evidence package to [Customer] on request and shall permit [Customer] to share that report with its auditors and regulators on a confidential basis.*

### 3. Minimum Level During the Term

> *Throughout the Term, [Supplier] shall maintain the [Product/Service] at no less than PQCMM Level [X] under the [self-assessment / third-party assessment / PKI Consortium certification] assurance method. A reduction in the assessed level or a loss of the required assurance method is a Material Change as defined in clause [Material Change Notification].*

### 4. Roadmap Commitments (optional)

> *[Supplier] shall achieve PQCMM Level [Y] for the [Product/Service] by no later than [Date] and PQCMM Level [Z] by no later than [Date], in each case verified under the [Third-Party Assessment / PKI Consortium Certification] assurance method. Failure to meet a milestone date by more than [N days] entitles [Customer] to the remedies set out in clause [Remedies].*

### 5. Material Change Notification

> *[Supplier] shall notify [Customer] in writing within [30 days] of any Material Change affecting the PQCMM level of the [Product/Service]. A "Material Change" includes, without limitation: a change to a cryptographic algorithm, parameter set, or default; a cryptographic library version change that adds, removes, or alters PQC support; a change to the zero-legacy configuration or supported deployment modes; a published vulnerability affecting an in-scope cryptographic component; suspension, revocation, or non-renewal of any PKI Consortium PQCMM Certificate; or a major product version release affecting the cryptographic implementation.*

### 6. Right to Require Updated Assessment

> *[Customer] may, no more than once per [12 months] (and additionally on the occurrence of any Material Change), require [Supplier] to provide an updated PQCMM assessment of the [Product/Service]. Where [Supplier] already commissions an annual third-party assessment, sharing the most recent report satisfies this clause. The cost of any additional bespoke assessment requested by [Customer] beyond [Supplier]'s standard cycle shall be borne by [Customer], unless the additional assessment is triggered by a Material Change or by a regression in the assessed level.*

### 7. Evidence Confidentiality

> *Assessment reports, SBOMs, CBOMs, and supporting evidence provided under this Agreement are Confidential Information of [Supplier]. [Customer] may share them with its employees, advisors, auditors, and regulators on a need-to-know basis subject to equivalent confidentiality obligations. Nothing in this clause prevents [Customer] from disclosing a [Supplier]'s assessed PQCMM level and assurance method internally for risk-management purposes.*

### 8. Remedies on Regression or Loss of Certification

> *If the [Product/Service] regresses below the required PQCMM Level, or any required PKI Consortium PQCMM Certificate is suspended, revoked, or not renewed, [Customer] may, in addition to any other remedies available at law or under this Agreement: (a) require [Supplier] to submit a written remediation plan with milestone dates, within [30 days]; (b) withhold further orders or new deployments under this Agreement until the level is restored; (c) terminate the affected statement of work or order on [N days] written notice if the level is not restored within the agreed remediation period; and/or (d) approve a time-limited written exception with compensating controls.*

### 9. Use of the PKI Consortium PQCMM Certification Mark

> *Any use by [Supplier] of the PKI Consortium PQCMM certification mark in connection with statements made to [Customer] or in materials provided to [Customer] shall comply with the [PQCMM Brand and Mark Usage Guidelines](/wg/pqc/pqcmm/assessment/brand-usage/), including the mandatory disclaimer text. [Supplier] shall not represent that the PKI Consortium has guaranteed, warranted, or endorsed the [Product/Service].*

### 10. No Reliance Beyond the Certificate

> *[Customer] acknowledges that a PKI Consortium PQCMM Certificate is a record that a qualifying third-party assessment was reviewed and accepted by the PKI Consortium. It is not a guarantee of security, fitness for purpose, or absence of vulnerabilities, and the PKI Consortium accepts no liability for the [Product/Service] or for any decision made in reliance on the certificate. [Customer]'s rights under this Agreement are against [Supplier].*

## Versioning

This page will be revised as the PQCMM evolves. Substantive changes are noted in the [PQCMM version history](/wg/pqc/pqcmm/version-history/).
