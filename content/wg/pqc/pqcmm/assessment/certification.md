---
date: 2026-05-07T00:00:00Z
linkTitle: "Certification"
title: "PKI Consortium Certification - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: PKI Consortium PQCMM Certification is an authoritative, consortium-issued certificate confirming that an independent third-party assessment of a product's PQC maturity has been reviewed and accepted by the PKI Consortium.
summary: The PKI Consortium reviews a qualifying third-party assessment report and, where it meets expectations, issues a PQCMM Certificate — the highest level of assurance in the PQCMM framework.
weight: 30
---

## What Is PKI Consortium PQCMM Certification?

PKI Consortium PQCMM Certification is a formal endorsement by the PKI Consortium confirming that:

1. An independent [third-party assessment](/wg/pqc/pqcmm/assessment/third-party/) has been conducted for the product.
2. The PKI Consortium has reviewed the assessment report.
3. The report's methodology, evidence, and conclusions meet the PKI Consortium's expectations for rigour and accuracy.
4. The claimed PQCMM level is recognised as valid by the PKI Consortium.

Certification is **not** a re-assessment — the PKI Consortium does not independently test the product. It is a review of the third-party assessment report to confirm it was conducted properly and that the conclusions are well-supported.

> A PKI Consortium PQCMM Certificate confirms that a qualifying third-party assessment report has been reviewed and accepted by the PKI Consortium. **It is not a guarantee of security, fitness for purpose, or absence of vulnerabilities, and the PKI Consortium accepts no liability for the assessed product or for any decision made in reliance on the certificate.**
{.callout-info}

## Certification Process

### 1. Obtain a Qualifying Third-Party Assessment

A PKIC-accepted third-party assessment report is required before applying for certification. The report must:

- Have been produced by an independent assessor (see [Third-Party Assessment](/wg/pqc/pqcmm/assessment/third-party/)).
- Cover a clearly scoped product or service with a specific version or release.
- Follow the PQCMM assessment methodology and reference the specific version of the PQCMM specification used.
- Be dated within 3 months of the certification application.

### 2. Submit the Application

The accredited independent assessor submits the certification application to the PKI Consortium on behalf of the vendor. The application must include:

- The digitally signed third-party assessment report (PDF), signed by both the assessor (attesting that the assessment was conducted in line with PQCMM methodology) and the vendor (warranting that the evidence package provided to the assessor is true and complete to the best of the vendor's knowledge).
- A **senior-executive attestation** signed on behalf of the vendor (see *Senior-Executive Attestation* below).
- The vendor's confirmation that the product assessed corresponds to a currently shipping version.
- The **product identifier(s)** for the assessed version, including a Common Platform Enumeration (CPE) 2.3 identifier where one exists (see *Product Identifiers* below).
- The assessor's prior-engagement disclosure (see [Third-Party Assessment](/wg/pqc/pqcmm/assessment/third-party/#prior-engagement-disclosure)).
- Acceptance of the PKI Consortium's certification terms (see *Certification Terms and Liability* below).
- Payment of the certification fee (see below).

### Senior-Executive Attestation

The vendor's certification application must be accompanied by a written attestation, signed by a **senior executive** of the vendor organisation who is accountable for the assessed product. The signatory must hold an executive role such as Chief Executive Officer, Chief Technology Officer, Chief Information Security Officer, Chief Product Officer, or an equivalent named officer with documented decision-making authority over the product's cryptographic posture. A signature from a delegated representative without that authority does not satisfy this requirement.

The attestation states that, to the best of the signatory's knowledge:

- The product, version, edition, deployment model, and configuration described in the assessment report correspond to what is shipped to customers under that name.
- The evidence package provided to the assessor is true and complete, with no material omissions.
- The signatory accepts personal accountability, on behalf of the organisation, for the accuracy of the claims made in the certification application.
- The vendor will notify the PKI Consortium of any material change in line with the *Material Change and Vendor Notification* section below.

The PKI Consortium records the name, title, and date of the executive signatory in the certification application. False attestation is grounds for refusal, suspension, or revocation of certification and may be referenced in any subsequent complaint or appeal.

### Product Identifiers

So that certified products can be unambiguously identified by procurement teams, vulnerability databases, and asset-management tooling, the application must record machine-readable product identifiers for the assessed version:

- A **Common Platform Enumeration (CPE)** identifier (current published version of the CPE specification) where one is published for the product. If no CPE has been issued, the vendor should request one from the NIST National Vulnerability Database (NVD) and may submit the application with an explanation in the interim.
- A **Package URL (purl)** where the product is distributed through a recognised package ecosystem.
- The vendor's own product, edition, and version identifiers as they appear in the SBOM/CBOM (see [Level 3](/wg/pqc/pqcmm/levels/3-advanced/) and [Level 4](/wg/pqc/pqcmm/levels/4-managed/)).

The model references these schemes by name rather than by version so that adoption of an updated specification (e.g., a future CPE revision) does not invalidate the requirement; see the [design principle on algorithm- and scheme-neutral criteria](/wg/pqc/pqcmm/#design-principles).

Recorded identifiers are published with the certificate in the [Certified Products & Services](/wg/pqc/pqcmm/products/) registry so they can be correlated with CVE feeds and automated supply-chain tooling.

### 3. PKI Consortium Review

The PKI Consortium reviews the assessment report for:

- **Completeness** — all criteria for the claimed level are addressed.
- **Evidence sufficiency** — the evidence cited in the report is adequate to support each criterion.
- **Methodology adherence** — the assessment was conducted in line with PQCMM assessment methodology.
- **Independence** — the assessor has no material conflict of interest with the vendor.

The review typically takes **4–6 weeks**. The PKI Consortium may request clarifications from the assessor during this period.

### 4. Certification Decision

The PKI Consortium issues one of three outcomes:

| Outcome | Meaning |
|---|---|
| **Certified** | The report meets expectations; the PKI Consortium PQCMM Certificate is issued. |
| **Conditional** | Minor gaps identified; the assessor must address specific points with the vendor before certification is issued. |
| **Not accepted** | The report does not meet the required standard; a new or revised assessment is required. |

### 5. Certificate Issuance

Upon a positive decision, the PKI Consortium issues a **PQCMM Certificate** specifying:

- The certified product name and version.
- The certified PQCMM level.
- The version of the PQCMM specification against which the assessment was performed.
- The date of certification and expiry date (12 months from the assessment report date).
- A unique certificate identifier for public verification.
- The recorded product identifiers, including the CPE identifier and any Package URL (purl) submitted with the application.
- The mandatory certification disclaimer (see *Certification Terms and Liability* below).

Certified products are listed on the PKI Consortium website together with their certificate identifier, level, PQCMM version, issue date, expiry date, and recorded product identifiers (CPE and purl where available) so that the listing can be cross-referenced with CVE feeds and asset-management tooling.

## Certification Terms and Liability

By submitting a certification application, the vendor and assessor accept the following terms:

- The PKI Consortium reviews the third-party assessment report; it does not test the product, does not validate the product's security, and does not warrant the product.
- The certificate is a record that a qualifying assessment was reviewed and accepted. It is not a guarantee of security, fitness for purpose, regulatory compliance, or absence of vulnerabilities.
- The PKI Consortium accepts no liability for the assessed product, for the assessor's work, for the accuracy of the evidence provided by the vendor, or for any decision made by any party in reliance on the certificate.
- The vendor and assessor jointly indemnify the PKI Consortium against claims arising from misrepresentation in the assessment report or evidence package.
- The PKI Consortium may suspend, revoke, or refuse to renew a certificate at its discretion in line with the rules below.

## Material Change and Vendor Notification

A *material change* ([see Glossary](/wg/pqc/pqcmm/glossary/)) to a certified product may invalidate the basis of the certificate. Vendors must notify the PKI Consortium within 30 days of a material change. Material changes include:

- A change to a cryptographic algorithm, parameter set, or default in the product.
- A cryptographic library version change that adds, removes, or alters PQC support.
- A change to the zero-legacy configuration or to the supported deployment modes.
- A published vulnerability (CVE or equivalent) affecting an in-scope cryptographic component.
- A major product version release.

Depending on the nature of the change, the PKI Consortium may require: continued validity with disclosure, an updated assessment, or revocation pending re-assessment.

## Revocation, Suspension, and Appeals

The PKI Consortium may **suspend** or **revoke** a certificate where:

- The vendor fails to disclose a material change.
- A material misrepresentation in the assessment report or evidence package is identified.
- The assessor is found to have lacked independence or to have departed materially from PQCMM methodology.
- A serious vulnerability in the product remains unaddressed beyond the vendor's published advisory timeframe.

Revoked and suspended certificates are recorded on the PKI Consortium website. The vendor is notified in writing with reasons.

**Complaints** about a certified product, an assessment report, or an assessor may be submitted to the PKI Consortium at contact at pkic dot org. The Consortium acknowledges complaints, investigates, and records the outcome.

**Appeals** against a *Not accepted* decision, a suspension, or a revocation may be submitted in writing within 30 days of the decision. Appeals are reviewed by individuals who were not involved in the original decision. The outcome of an appeal is final.

## Certification Fees

Certification fees contribute to the cost of the PKI Consortium's review process and the PKI Consortium [goals](/about/). Assessors manage this step as part of the overall certification engagement with the vendor.

PKI Consortium members benefit from reduced certification fees. See [membership benefits](/join/) for details.

## Certificate Validity and Renewal

Becoming quantum-ready or quantum-safe is not simply performing a one-time migration; we are transitioning to a state of **Cryptographic Agility** and **Cryptographic Resilience**. This isn't a project with a finish line, but the operationalization of a **Modern Cryptographic Lifecycle** that ensures security remains resilient against current and future threats. For this reason, a PKI Consortium PQCMM Certificate is valid for **12 months** from the date of the underlying assessment report. To maintain certified status, vendors must:

- Commission a new third-party assessment covering the current product version.
- Submit a renewal application with the updated report before the certificate expires.

Material changes to the product (see *Material Change and Vendor Notification* above) require notification and may require re-assessment before the change is released under a certified claim.

### Expiry and Lapsed Certificates

On the expiry date, a certificate that has not been renewed is automatically marked **expired** in the PKI Consortium's public listing. The historical record of the certificate (identifier, product, level, dates, PQCMM version) is retained so that prior claims remain auditable. After a defined retention period without renewal, expired certificates may be removed from the active listing while remaining accessible in the historical record. Vendors should notify their customers of any non-renewal or lapse.

## PQCMM Versioning and Reference

Each PQCMM Certificate references the version of the PQCMM specification against which the assessment was performed. The PQCMM is versioned semantically: a change to the level criteria or the assessment requirements results in a new minor or major version, while editorial corrections that do not change requirements are released as patch versions. The version history is maintained on GitHub and linked from the [PQCMM home page](/wg/pqc/pqcmm/). A certificate's validity is anchored to the PQCMM version recorded on its face; subsequent revisions of the model do not retroactively invalidate or upgrade existing certificates.

## Displaying the Certificate

Certified vendors may display the PKI Consortium PQCMM certification mark on their product documentation, website, and marketing materials, subject to the [PQCMM Brand and Mark Usage Guidelines](/wg/pqc/pqcmm/assessment/brand-usage/). The mark must reference the specific level achieved, the PQCMM version, and the certificate validity period, and must be accompanied by the standard disclaimer set out in the Brand and Mark Usage Guidelines.

