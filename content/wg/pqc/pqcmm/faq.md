---
date: 2026-05-07T00:00:00Z
linkTitle: "FAQ"
title: "Frequently Asked Questions"
description: Frequently asked questions about the PQC Maturity Model, including scope, levels, assessment methods, certification, evidence, software bills of materials, cryptographic bills of materials, and how the model relates to other PKI Consortium work.
summary: Answers to common questions about what the model measures, how levels work, how assessment and certification differ, and how organizations and vendors should use it.
weight: 40
---

If you have a question that is not covered here, feel free to [raise it in our community discussions](/discussions).

{{< faq >}}
groups:
  - title: Model Scope
    questions:
      - question: "What does the PQCMM measure?"
        open: true
        answer: |
          The PQC Maturity Model measures the post-quantum cryptography maturity of a specific product or service. It asks whether quantum-safe cryptography is absent, available for testing, production-ready, inventory-backed, managed, or enabled by default.
      - question: "Does the PQCMM assess an organization?"
        answer: |
          No. It is product and service-centric. An organization may have one product at [Level 4](/wg/pqc/pqcmm/levels/4-managed/), another at [Level 2](/wg/pqc/pqcmm/levels/2-basic/), and another at [Level 0](/wg/pqc/pqcmm/levels/0-none/).
      - question: "Does the PQCMM require hybrid cryptography?"
        answer: |
          No. The PQCMM is intentionally neutral on whether vendors should use pure post-quantum algorithms, hybrid (classical + PQ) constructions, or composite signatures. Different regions and regulators take different positions — some require hybrid for the migration window, others discourage it because of the additional complexity. The model defines what hybrid and composite support means at [Level 4](/wg/pqc/pqcmm/levels/4-managed/) and what "PQC by default" means at [Level 5](/wg/pqc/pqcmm/levels/5-optimized/), and lets vendors and buyers choose the approach appropriate to their threat model and applicable guidance.
      - question: "How is the PQCMM different from the PKI Maturity Model?"
        answer: |
          The [PKI Maturity Model](/wg/pkimm/model/) assesses organizational public key infrastructure operations across multiple domains. It has its own dedicated Post-Quantum Cryptography transition layer specifically to assess the PQC maturity of a PKI operation. The PQCMM assesses post-quantum cryptography readiness for individual products and services.
      - question: "How is the PQCMM different from the PQC Capabilities Matrix?"
        answer: |
          The Post-Quantum Cryptography Capabilities Matrix tracks vendor capabilities. The PQCMM defines a maturity scale and assessment model that can be used in procurement, vendor risk, and certification.
  - title: Levels
    questions:
      - question: "Are the levels cumulative?"
        answer: |
          Yes. A product claiming [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) must meet all [Level 1](/wg/pqc/pqcmm/levels/1-initial/), [Level 2](/wg/pqc/pqcmm/levels/2-basic/), and [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) criteria. The assessed level is the highest level where all criteria are met.
      - question: "Is Level 0 a failure?"
        answer: |
          [Level 0](/wg/pqc/pqcmm/levels/0-none/) means no post-quantum cryptography has been implemented for the assessed product or service. It may be acceptable for low-risk, short-lived, or easily replaceable products, but it is a serious concern for products protecting long-lived sensitive data or trust infrastructure.
      - question: "Can a vendor claim partial Level 4?"
        answer: |
          Not as an assessed level. The current level remains the highest fully met level. Partially met criteria should be recorded as roadmap or gap information.
      - question: "Can a product have different levels for different deployment modes?"
        answer: |
          Yes. If capabilities differ between software-as-a-service, on-premises, cloud region, tenant mode, hardware version, or configuration, the assessment report should state the exact scope.
  - title: Choosing an Assessment Method
    questions:
      - question: "What is the difference between self-assessment, third-party assessment, and certification?"
        answer: |
          Self-assessment is performed by the vendor or buyer. Third-party assessment is performed by an independent assessor. PKI Consortium certification is authoritative recognition based on review and acceptance of a qualifying assessment.
      - question: "Which assessment method should we use first?"
        answer: |
          Start with self-assessment to establish baseline visibility. Use third-party assessment or PKI Consortium certification when the product is critical, regulated, externally relied upon, or part of trust infrastructure.
      - question: "Can a buyer perform its own assessment?"
        answer: |
          Yes, if the buyer has sufficient expertise and access to evidence. Buyer-led assessment can support internal risk decisions, but it should not be presented as vendor certification.
      - question: "Which method should a buyer require?"
        answer: |
          Use risk. Self-assessment may be enough for baseline visibility and low-risk purchases. Third-party assessment is appropriate for high-risk suppliers. Certification should be required for highest-assurance procurement where authoritative validation is necessary.
      - question: "Who should pay for third-party assessment?"
        answer: |
          This is a commercial decision. Vendors may fund assessments to support multiple customers. Buyers may fund assessments for strategic suppliers or bespoke products. Contracts should state who pays, who receives the report, and who may rely on it.
  - title: Assessment Report Scope
    questions:
      - question: "What should an assessment report cover?"
        answer: |
          It should identify the product or service, version, deployment model, configuration, claimed level, assurance method, criteria reviewed, evidence examined, reproduction attempts where applicable, gaps, and assessor conclusions.
      - question: "Can one report cover multiple products?"
        answer: |
          Only if the report explicitly scopes each product or service and maps evidence to each one. A broad organization-level statement is not enough for product-level PQCMM claims.
      - question: "Can a software-as-a-service provider provide one assessment for all customers?"
        answer: |
          Yes, if customers use the assessed service and configuration. If regions, tenant types, editions, or customer-managed settings materially affect cryptography, the report should state those limits.
  - title: Assessment Validity and Reassessment
    questions:
      - question: "Why is reassessment or re-certification required?"
        answer: |
          Becoming quantum-ready or quantum-safe is not simply performing a one-time migration; we are transitioning to a state of **Cryptographic Agility** and **Cryptographic Resilience**. This isn't a project with a finish line, but a shift to a **Modern Cryptographic Lifecycle**. Software receives new features, bugs are patched, and algorithms will mature or be compromised over time. Regular reassessment guarantees that a product maintains its maturity within this continuous lifecycle.
      - question: "How long is an assessment report valid?"
        answer: |
          Set a policy based on risk. Annual review is a common baseline. Critical products may need shorter cycles. Any major cryptographic or product change should trigger reassessment regardless of age.
      - question: "What changes trigger reassessment?"
        answer: |
          Major version releases, cryptographic library updates, algorithm changes, key-management changes, protocol changes, deployment model changes, security incidents, and newly applicable standards or regulatory requirements.
      - question: "What if the product regresses?"
        answer: |
          The vendor should disclose the regression, provide an updated assessment, identify affected customers, and define remediation. Buyers should update the supplier inventory and apply contract remedies or exceptions as appropriate.
  - title: Evidence and Confidentiality
    questions:
      - question: "What evidence should support a PQCMM claim?"
        answer: |
          Evidence may include product documentation, release notes, configuration guides, algorithm and parameter-set lists, software bills of materials, cryptographic bills of materials, interoperability reports, validation results, benchmark results, and assessment reports.
      - question: "Why do software bills of materials and cryptographic bills of materials matter?"
        answer: |
          Software bills of materials identify software components and dependencies. Cryptographic bills of materials identify cryptographic algorithms, protocols, key sizes, libraries, and usage contexts. They help buyers understand cryptographic exposure and migration risk.
      - question: "What if a vendor will not share software bill of materials or cryptographic bill of materials data?"
        answer: |
          Ask whether the evidence can be shared under non-disclosure agreement, through a secure portal, in redacted form, or through an independent assessor. If the claimed level requires inventory evidence and the vendor cannot provide it in any form, the claim should not be accepted without qualification.
      - question: "How should reports be stored?"
        answer: |
          Store reports according to sensitivity. Assessment reports, software bills of materials, and cryptographic bills of materials may reveal implementation details. Limit access, define retention, and record whether evidence is subject to non-disclosure agreement or export-control constraints.
      - question: "What if two assessors disagree?"
        answer: |
          Compare scope, evidence, criteria interpretation, report date, and reproduction methods. For critical decisions, request clarification from the vendor and assessor, or require certification or a second independent review.
  - title: Adoption and Procurement
    questions:
      - question: "Who should use the PQCMM?"
        answer: |
          Procurement teams, vendor risk teams, security architects, auditors, regulators, and vendors can all use the model. Buyers use it to compare products. Vendors use it to communicate readiness and roadmap progress.
      - question: "How should we start?"
        answer: |
          Start with high-priority suppliers and new procurements. Require an assessment or certification report, record the level and assurance method, and build a supplier inventory over time.
      - question: "Should gating questions be optional?"
        answer: |
          No. If the PQCMM is being used as a procurement or vendor-risk control, the core intake questions should be mandatory. Every in-scope vendor should provide a product-specific assessment or certification report, state the claimed level, and identify whether the claim is self-assessed, third-party assessed, or PKI Consortium certified.
      - question: "What if a vendor will not provide a report?"
        answer: |
          Treat the claim as unsupported. Depending on procurement rules and risk, the response can be rejected, scored as unverified, accepted only under a temporary exception, or escalated for commercial negotiation.
      - question: "Can a vendor submit marketing material instead of an assessment report?"
        answer: |
          Marketing material can provide context, but it should not replace a criteria-level assessment or certification report. The report should map evidence to the PQCMM criteria for the claimed level and all lower levels.
      - question: "What if the vendor claims partial Level 3?"
        answer: |
          Partial progress is useful roadmap information, but it is not a PQCMM level. The current level is the highest level where all criteria are fully met. Record partially met next-level criteria as gaps or roadmap items.
  - title: Scoring and Evaluation
    questions:
      - question: "Should PQCMM be pass/fail or scored?"
        answer: |
          The PQCMM is structured around clear gates: a product either meets every criterion of a level or it does not. Buyers can use this directly — verify the minimum level, require the actual report, check the scope match, and check the assurance method (self-assessment, third-party, or PKI Consortium certification). Within the constraints of an evidence-based assessment, some criteria still rely on the assessor's judgement of the supporting evidence; this is why the assurance method matters when comparing two claims at the same level.
      - question: "How do we compare two vendors with the same level?"
        answer: |
          When two vendors claim the same level, the Assurance Method serves as your primary differentiator. A [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) third-party assessed product provides significantly higher confidence and should score higher than a [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) self-assessed product.
      - question: "Can a roadmap compensate for a low current level?"
        answer: |
          No. Do not award partial credit or "roadmap points" toward the current level. A roadmap can justify a business exception for procurement, but the vendor's current score in evaluation must reflect their achieved maturity today.
      - question: "Do procurement teams need to evaluate CBOMs and SBOMs?"
        answer: |
          No. The responsibility of gathering and verifying sensitive technical evidence belongs to the assessment process (the vendor or their third-party assessor). Procurement teams only need to verify the authenticity of the final report or certificate.
  - title: Exceptions
    questions:
      - question: "What if no vendor in the market meets the required level?"
        answer: |
          Document the market constraint, select the best available option, require a contractual roadmap, define compensating controls, and approve a time-limited exception. Revisit the market at renewal or milestone dates.
      - question: "What if a vendor regresses after award?"
        answer: |
          Use the contract's reassessment and remediation clauses. Record the regression, require an updated assessment, evaluate operational impact, and decide whether remediation, exception, or replacement planning is required.
      - question: "How can we provide feedback?"
        answer: |
          The PQCMM is a living model. Feedback is welcome through [PKI Consortium discussions](/discussions).
  - title: Identifiers and Accountability
    questions:
      - question: "Is a Common Platform Enumeration (CPE) identifier required?"
        answer: |
          A CPE identifier is required at certification where one has been issued for the product, and is requested in the SBOM at [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) and bound to CBOM entries at [Level 4](/wg/pqc/pqcmm/levels/4-managed/). CPE (with Package URL (purl) as an equivalent for package-distributed software) enables automated correlation between PQCMM certificates, SBOM/CBOM data, and CVE feeds such as the NIST National Vulnerability Database. The model references the CPE scheme by name rather than by version so that adoption of an updated CPE specification does not invalidate the requirement. If no CPE has been issued, the vendor should request one and may submit a certification application with an explanation in the interim.
      - question: "Who inside the vendor organisation must sign a certification application?"
        answer: |
          A [senior executive](/wg/pqc/pqcmm/assessment/certification/#senior-executive-attestation) accountable for the assessed product — typically the CEO, CTO, CISO, CPO, or an equivalent named officer with decision-making authority over the product's cryptographic posture. Delegated representatives without that authority do not satisfy the attestation requirement.
{{< /faq >}}

