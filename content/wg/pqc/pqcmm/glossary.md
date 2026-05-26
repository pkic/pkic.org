---
date: 2026-05-07T00:00:00Z
linkTitle: "Glossary"
title: "Glossary - PQC Maturity Model (PQCMM)"
description: Plain-English definitions for common terms used in the PQC Maturity Model, including PQC, PQCMM, SBOM, CBOM, crypto agility, hybrid cryptography, and certification.
summary: Plain-English definitions for terms used across the model, assessment, procurement, scoring, and adoption guidance.
weight: 35
---

{{< glossary >}}
terms:
  - term: "Post-Quantum Cryptography (PQC)"
    definition: |
      Cryptographic algorithms designed to resist attacks by both classical computers and cryptographically relevant quantum computers.
      
  - term: "PQC Maturity Model (PQCMM)"
    definition: |
      The PKI Consortium model for describing how mature a specific product or service is in its adoption of post-quantum cryptography.
      
  - term: "PKI Consortium"
    definition: |
      The industry consortium stewarding this model and related public key infrastructure initiatives.
      
  - term: "Quantum-safe"
    definition: |
      A property of a product or service that uses cryptography expected to remain secure against attacks by both classical and cryptographically relevant quantum computers. In the context of the PQCMM, "quantum-safe" claims must be substantiated by reference to published post-quantum standards (such as NIST FIPS 203/204/205 or equivalent ETSI/ISO publications) at appropriate parameter sets, used either standalone or in hybrid/composite constructions. Vendor intent or roadmap commitments alone do not make a product quantum-safe.
      
  - term: "Cryptographically Relevant Quantum Computer (CRQC)"
    definition: |
      A quantum computer capable of breaking widely used public-key cryptography at practical scale.
      
  - term: "Store-Now-Decrypt-Later Risk"
    definition: |
      The risk that encrypted data is captured today and decrypted later when quantum capabilities become available. This matters most for data that must remain confidential for many years.
      
  - term: "Crypto Agility"
    definition: |
      The ability to change cryptographic algorithms, libraries, parameters, or configurations without major redesign or replacement. In the context of the PQCMM this means: cryptographic algorithm identifiers and parameters are externalised from hard-coded values; at least two algorithms can be selected for the same role through configuration; and an algorithm change can be deployed and reverted without rebuilding the product.

  - term: "Cryptographic Resilience"
    definition: |
      The ability of a product or service to continue operating securely when a cryptographic algorithm, parameter set, or implementation is deprecated, broken, or otherwise withdrawn. Resilience combines crypto agility (the technical capability to change) with operational practices (deprecation policy, advisory process, tested rollback, and the ability to issue updates within a defined timeframe).
      
  - term: "Software Bill of Materials (SBOM)"
    definition: |
      An inventory of software components and dependencies in a product.
      
  - term: "Cryptographic Bill of Materials (CBOM)"
    definition: |
      An inventory of cryptographic algorithms, protocols, key sizes, libraries, certificates, and usage contexts in a product.
      
  - term: "Self-Assessment"
    definition: |
      An assessment performed by the vendor or buyer. It is useful for baseline visibility but is not independent assurance.
      
  - term: "Third-Party Assessment"
    definition: |
      An assessment performed by an independent assessor who reviews evidence and validates claims.
      
  - term: "PKI Consortium Certification"
    definition: |
      Authoritative certification issued by the PKI Consortium after review and acceptance of a qualifying assessment.
      
  - term: "Evidence Matrix"
    definition: |
      A table mapping each criterion at the claimed level and all lower levels to the evidence supporting that claim.
      
  - term: "Assessment Scope"
    definition: |
      The product or service as named, released, and shipped by the vendor — including all of its cryptographic functionality. The PQCMM does not permit excluding parts of the product from the scope; if a feature is part of the product, it is part of the assessment. The scope statement must clearly identify the product or service name, version or release identifier, and any deployment modes covered (e.g., cloud, on-premises, container).

  - term: "Material Change"
    definition: |
      Any change to a certified product that may affect its PQCMM level. Material changes include: a change to a cryptographic algorithm, parameter set, or default; a cryptographic library version change that adds, removes, or alters PQC support; a change to the zero-legacy configuration; a published vulnerability affecting an in-scope cryptographic component; a change to the supported deployment modes covered by the certificate; or a major product version release. Material changes require notification to the PKI Consortium and may require re-assessment.

  - term: "Independence"
    definition: |
      In the context of a third-party PQCMM assessment, independence means the assessor is a separate legal entity from the vendor, has no financial interest in the assessed product beyond the assessment fee, and has no undisclosed conflict of interest. The assessor's independence is asserted by the assessor (not the vendor) in the assessment report.

  - term: "Conflict of Interest"
    definition: |
      Any relationship, interest, or engagement that could reasonably be perceived to influence the assessor's judgement — including ownership, employment, board or advisory positions, undisclosed consulting, or revenue dependency on the vendor. Conflicts must be disclosed to the PKI Consortium as part of any certification application.
      
  - term: "Exception"
    definition: |
      A time-limited, approved deviation from the required level or assurance method, with compensating controls and a remediation plan.
{{< /glossary >}}

