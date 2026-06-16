---
title: "Defining 'Quantum-Ready' for the Supply Chain: Introducing the PQC Maturity Model (PQCMM)"
summary: |
  The PKI Consortium is introducing the Post-Quantum Cryptography Maturity Model (PQCMM), a standardized framework to define what quantum-readiness means for products and services. Learn how this model simplifies vendor evaluation and helps procurement teams secure their digital supply chain.
authors:
  - Paul van Brouwershaven
date: 2026-06-14T12:00:00+02:00
keywords: [PQC, Post-Quantum Cryptography, PQCMM, Maturity Model, Supply Chain, Procurement, Cryptographic Agility, Digital Trust]
tags: [PQC, Post-Quantum Cryptography, PQCMM, Supply Chain, PKI]

params:
    heroTitle: "Defining 'Quantum-Ready' for the Supply Chain: Introducing the PQC Maturity Model (PQCMM)"
    heroImage: pqcmm-cover.png
    heroDescription: Simplifying post-quantum readiness with a clear, shared framework for vendors and buyers.
---

As organizations prepare for the post-quantum era, terms like *quantum-ready* and *quantum-safe* are being widely used by technology providers. However, without a common definition, these claims vary from vendor to vendor. This lack of standardization leaves procurement, supply chain, and risk management teams with the difficult task of deciphering what these claims actually mean for their organization's security.

To address this challenge, the **PKI Consortium Post-Quantum Cryptography (PQC) Working Group** is introducing the **[Post-Quantum Cryptography Maturity Model (PQCMM)](/wg/pqc/pqcmm/)**. 

The PQCMM is a product-centric framework designed to establish a clear, shared language for post-quantum readiness across all products and services that rely on cryptography.

## Why Having a Standard Framework Matters

When migrating to post-quantum cryptography, organizations cannot rely on a single, one-time project. We are entering a long-term transition toward cryptographic agility and resilience. Because this landscape is constantly evolving, having a structured framework to build on and refer to is vital.

The PQCMM provides a stable, vendor-neutral baseline that defines maturity across six levels (from Level 0 to Level 5):

* **Level 0 (None):** No PQC implemented.
* **Level 1 (Initial):** PQC capabilities available for testing and evaluation.
* **Level 2 (Foundational):** Production-ready, standards-compliant PQC support.
* **Level 3 (Advanced):** Cryptographic inventory, SBOM support, and cryptographic agility.
* **Level 4 (Managed):** CBOM support, hybrid cryptography, and zero-legacy capability.
* **Level 5 (Optimized):** PQC by default, benchmarked performance, and certified implementations.

Rather than trying to evaluate cryptographic capabilities in a vacuum, organizations and vendors can refer to these defined levels to measure progress consistently.

## Making Life Easier for Procurement and Supply Chain Teams

For procurement and vendor risk teams, evaluating the security posture of third-party products is historically complex and time-consuming. Traditionally, teams have had to send customized, lengthy security questionnaires to every supplier, only to receive inconsistent, marketing-heavy answers that are difficult to compare.

The PQCMM changes this dynamic and makes the lives of procurement teams much easier:
* **A Common Language:** It replaces vague vendor assertions with a standardized, objective scale. 
* **Simplified Intake:** Instead of designing bespoke questionnaires, procurement teams can simply refer to the PQCMM. You can ask vendors (both existing and new) where their product sits on the PQCMM scale and what their roadmap looks like.
* **Consistent Benchmarking:** Supply chain teams can compare competing products side-by-side using the same criteria, ensuring that purchasing decisions align with the organization's cryptographic risk appetite.

## Getting Started Is Easy

One of the greatest strengths of the PQCMM is how easy it is to get started. You do not need to be a cryptographic expert or deploy complex compliance tooling to begin using the model:
1. **Identify Critical Suppliers:** Start with the high-priority software, hardware, and cloud services in your supply chain that protect long-lived or sensitive data.
2. **Start the Conversation:** Reach out to these vendors and ask: *"How does your product align with the PQCMM levels?"* 
3. **Set Future Requirements:** Use the PQCMM levels as reference points in upcoming RFPs and contracts to set clear, progressive milestones for new vendors.

By referencing a standardized model, you set a clear, predictable expectation for your vendors without adding administrative overhead.

## Looking Ahead: Certification and Third-Party Assessments

To build on this foundation and provide the highest level of assurance for critical digital infrastructure, we are starting to work with third-party assessors and auditors. Our goal is to launch a formal **PQCMM Certification Program** near the end of the year, with plans to officially announce the program at the upcoming [Post-Quantum Cryptography Conference in Amsterdam](/events/2026/pqc-conference-amsterdam-nl/) on December 1-3, 2026.

Under this upcoming certification program, independent qualified assessors will validate vendor evidence and issue formal PQCMM certificates, giving procurement teams reliable verification of a product's level.

## We Want Your Feedback

The PQCMM is a community-driven initiative, and we want to ensure it reflects the practical needs of both the organizations buying cryptographic products and the vendors building them. As we refine the model's criteria and prepare for the certification program, we are seeking feedback and looking for early participants:

* **For Organizations and Vendors:** If you would like to run a Proof of Concept (POC) with one of our third-party auditing partners to evaluate a product's readiness under the model, please reach out.
* **For Auditors and Assessors:** If your organization performs independent cryptographic assessments, audits, or structural security reviews, and you want to join our cohort of third-party qualified assessors, we want to hear from you.
* **Share Your Thoughts:** We welcome feedback on the model structure, level definitions, and applicability.

To share your feedback, inquire about running a POC, or join the assessor cohort, please contact us at **contact@pkic.org** or join the discussion on the [PKI Consortium Discussions page](/discussions).
