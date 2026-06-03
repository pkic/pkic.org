---
date: 2026-05-07T00:00:00Z
linkTitle: "Procurement"
title: "Procurement and Tender Guidance - PQC Maturity Model (PQCMM)"
description: How to use PQC Maturity Model levels, assessment methods, tender clauses, contract milestones, and renewal controls in procurement processes.
summary: "Apply the PQC Maturity Model throughout procurement: market research, request for information, request for proposal, tender evaluation, contract award, onboarding, renewal, and supplier remediation."
weight: 20
---

## Where the PQCMM Fits

The PQC Maturity Model (PQCMM) can be used throughout the procurement lifecycle. It is most effective when it is introduced early, before the organization has already selected a vendor.

For teams that need a ready-made due-diligence questionnaire, the [Vendor Assessment Survey](../survey/) provides the mandatory intake questions and a downloadable scorecard template that can be dropped into a tender, request for information, or renewal review without further drafting. The [Evaluation rubric](../evaluation/) covers how to score the responses and weigh evidence quality. The rest of this page focuses on **where** in the procurement lifecycle to apply the model and **what** contract language to use.

```mermaid
flowchart LR
  classDef plan fill:#1e3f7a,stroke:#4a7fd4,color:#fff
  classDef gate fill:#0d5c52,stroke:#1a9e8a,color:#fff
  classDef action fill:#2f5fc7,stroke:#4a7fd4,color:#fff
  classDef monitor fill:#6b42c8,stroke:#7f58d4,color:#fff

  Market[Market research]:::plan
  RFI[Request for information]:::plan
  Tender[Request for proposal / tender]:::gate
  Evaluate[Gate and score responses]:::gate
  Contract[Contract clauses and milestones]:::action
  Inventory[Supplier inventory]:::monitor
  Review[Reassessment and renewal]:::monitor

  Market --> RFI --> Tender --> Evaluate --> Contract --> Inventory --> Review
  Review --> RFI
```

| Stage | How to use the PQCMM |
|---|-----|
| Market research | Identify whether the market can meet the required level and assurance method |
| Request for information | Ask vendors for their current PQCMM level, assessment method, and roadmap |
| Request for proposal or tender | Set minimum level, report, evidence, and assurance requirements |
| Evaluation | Apply pass/fail gates, score level and assurance, and review evidence quality |
| Contract award | Include level commitments, reassessment obligations, and remediation milestones |
| Onboarding | Record the result in the supplier inventory and confirm evidence retention |
| Renewal | Reassess level, report age, product changes, and roadmap progress |

This keeps complexity out of the organization: the buyer sets the required level and assurance method; the vendor provides the product-specific report and evidence; the review team checks gates and records the result.

## Setting Minimum Requirements

Minimum PQCMM levels should be risk-based. A single organization may use different thresholds for different purchases. For each use case the buyer should state **two** values: a *minimum acceptable* level (below which a bid is non-responsive) and a *recommended target* (which scores higher in evaluation and is the basis for the contract roadmap). Distinguishing the two avoids forcing buyers to choose between an immediately-available floor and the level they actually want.

| Use case | Minimum acceptable | Recommended target | Assurance expectation |
|-----|--|--|------|
| Low sensitivity, short-lived data, easily replaceable product | [Level 1](/wg/pqc/pqcmm/levels/1-initial/) with roadmap to [Level 2](/wg/pqc/pqcmm/levels/2-foundational/) | [Level 2](/wg/pqc/pqcmm/levels/2-foundational/) | Self-assessment may be acceptable |
| Standard production system using cryptography | [Level 2](/wg/pqc/pqcmm/levels/2-foundational/) | [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) | Self-assessment with evidence; third-party assessment preferred for material suppliers |
| Regulated data, multi-year confidentiality need, identity infrastructure, or high supplier dependency | [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) | [Level 4](/wg/pqc/pqcmm/levels/4-managed/) | Third-party assessment recommended |
| Public trust, root or issuing infrastructure, firmware signing, payment, healthcare, critical infrastructure, or long-lived sensitive data | [Level 4](/wg/pqc/pqcmm/levels/4-managed/) | [Level 5](/wg/pqc/pqcmm/levels/5-optimized/) | Third-party assessment expected; certification preferred |
| National security, high-assurance government, critical public infrastructure, or strategic trust services | [Level 5](/wg/pqc/pqcmm/levels/5-optimized/) or explicit [Level 4](/wg/pqc/pqcmm/levels/4-managed/)+ migration plan | [Level 5](/wg/pqc/pqcmm/levels/5-optimized/) with active maintenance | PKI Consortium certification or equivalent highest-assurance route should be required where available |

When the market cannot yet meet the desired level, keep the target but define a temporary exception, compensating controls, and a contractual milestone.

### Worked Example — Standard Production System Using Cryptography

A mid-sized organization is renewing a customer-facing **business application** that uses TLS for client traffic, stores customer records in a managed database, signs outbound webhooks, and integrates with two external identity providers. Data is moderately sensitive (some personally identifiable information), but most records have a retention horizon of two to three years.

- **Minimum acceptable:** Level 2. The vendor must demonstrate production-ready, standards-conformant PQC in the components named above (TLS termination, database encryption-at-rest, webhook signing), backed by a self-assessment with evidence references the renewal team can spot-check.
- **Recommended target:** Level 3. Preferred for award scoring, and required at contract renewal in two years. Drives an SBOM and crypto-agility commitment so the organization can plan migrations without re-procuring.
- **Procurement actions:** ask question 2 of the [Vendor Assessment Survey](../survey/) at the request-for-information stage; include both the Level Commitment and Milestone Commitment clauses below; record the result in the [Supplier Inventory](../inventory/) at *Moderate* risk tier; reassess at the next major version or at renewal, whichever comes first.

The same pattern — declare both a minimum acceptable and a recommended target, derive the survey questions, write the milestone into the contract, record in the inventory — applies to every row of the table above.

## Procurement Timelines

Give vendors explicit deadlines so evidence review does not slip until the end of evaluation.

| Procurement stage | Suggested timing |
|---|-----|
| Market research | Ask for current level and likely assessment method before writing hard requirements |
| Request for information | Require initial report availability statement within the normal response deadline |
| Tender submission | Require the full assessment or certification report with the bid |
| Clarification window | Allow a short, fixed period for missing metadata or evidence references |
| Contract award | Require final scope match and any exception approval before award |
| Onboarding | Record report, evidence handling status, next review date, and contractual milestones |
| Renewal | Require updated assessment before renewal decision for in-scope products |

## Request for Information Language

Use a request for information to understand market readiness before setting a hard tender requirement:

> *For the product or service in scope, state the current PQC Maturity Model level, the assurance method supporting the claim (self-assessed, third-party assessed, or PKI Consortium certified), and whether an assessment or certification report is available. If the product does not currently meet Level [X], describe the roadmap, target date, dependencies, and evidence that will demonstrate completion.*

## Request for Proposal or Tender Requirement

Use a firm requirement when PQC readiness affects award eligibility:

> *The offered product or service must meet or exceed PQCMM Level [X] at contract award or by [date]. The supplier must provide a product-specific assessment or certification report covering the offered version, edition, deployment model, and configuration. The report must identify the assurance method as self-assessed, third-party assessed, or PKI Consortium certified. Unsupported claims may be treated as non-responsive.*

## Copy-Paste Requirements

Use the lightest clause that matches the risk.

| Use case | Suggested requirement |
|---|-----|
| Baseline supplier visibility | Supplier must submit a product-specific PQCMM self-assessment report with evidence references. |
| Standard production procurement | Supplier must meet Level [X] and provide an assessment report covering the offered product and version. |
| High-tier procurement | Supplier must provide a third-party assessment report, or a time-limited exception approved before award. |
| Certification precondition | Supplier must provide a valid PKI Consortium PQCMM certificate for the product, version, deployment model, and configuration offered. |
| Roadmap-based award | Supplier must meet Level [X] by [date], with contract milestones, reporting obligations, and remedies for missed dates. |

## Award Preconditions

For higher-risk procurements, define explicit gates:

| Gate | Example requirement |
|---|-----|
| Report gate | Vendor must submit a PQCMM assessment or certification report |
| Level gate | Product must meet Level 2, 3, 4, or 5 depending on risk |
| Assurance gate | High-tier products must have third-party assessment or certification |
| Scope gate | Report must cover the exact product, version, deployment model, and configuration |
| Evidence gate | Criteria-level evidence must be provided or made available under appropriate confidentiality terms |

## Contract Clauses

### Level Commitment

> *The supplier warrants that the product or service identified in Schedule [X] meets PQCMM Level [X] as of the effective date, supported by the assessment or certification report listed in Schedule [Y].*

### Reassessment Trigger

> *The supplier shall notify the customer of any material cryptographic change, major version release, algorithm change, cryptographic library replacement, deployment model change, or security incident affecting the assessed product. The supplier shall provide an updated PQCMM assessment within [90] days of such event or before production deployment, whichever occurs first.*

### Milestone Commitment

> *The supplier shall achieve PQCMM Level [X] by [date] and provide a third-party assessment or PKI Consortium certification report confirming achievement. Failure to meet the milestone shall trigger the remediation process in Schedule [Z].*

### Evidence Maintenance

> *The supplier shall maintain evidence supporting the claimed PQCMM level for the duration of the contract and provide updated evidence upon renewal, audit, material product change, or reasonable customer request.*

### Assessment Cost and Reliance

> *The parties shall agree who is responsible for the cost of any required third-party assessment or certification. The agreement shall state who may receive the report, who may rely on it, how confidential evidence is handled, and whether updated reports are required for future renewals or product changes.*

## Exceptions and Waivers

Exceptions should be formal, time-limited, and visible. A waiver should include:

- Product and supplier name.
- Required level and actual level.
- Reason the exception is needed.
- Business owner and risk owner.
- Compensating controls.
- Target date for remediation.
- Review cadence.
- Executive or risk-committee approval for critical products.

Do not let exceptions become permanent procurement defaults. If a High-tier vendor remains below the required level across repeated review cycles, treat it as a supplier risk requiring escalation or replacement planning.

