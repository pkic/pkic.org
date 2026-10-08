# PQCMM Assessment Architecture

## Model Differences

The PKI Maturity Model (PKIMM) and PQC Maturity Model (PQCMM) share level names, but they do not use the same assessment semantics.

| Concern          | PKIMM                                                         | PQCMM                                                                                                             |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Subject          | An organization's PKI operation                               | One named product or service and its deployment scope                                                             |
| Structure        | Modules, categories, requirements, and category weights       | Six product maturity levels with normative criteria and supporting assessment questions                           |
| Calculation      | Weighted category and requirement maturity ratings            | Gate model: every criterion at a positive level and every lower positive level must be met                        |
| Level 0          | Not part of the weighted positive maturity calculation        | Mutually exclusive baseline declaration; both Level 0 criteria must be met, but evidence is not required          |
| Partial progress | Contributes to detailed maturity calculations                 | Useful as a gap, but never establishes the level                                                                  |
| Evidence         | Notes and references can support detailed requirement ratings | Positive-level criteria require an evidence statement or attached evidence file                                   |
| Scope            | Categories and requirements can be marked not applicable      | The named product or service is assessed as released; product components cannot be excluded to improve the result |

The assessment questions guide evidence collection. They do not silently add normative criteria or replace the assessor's explicit criterion decision.

## Model Package and Shared Runtime

Normative model text and assessment behavior are separate, versioned inputs:

- `pqcmm-model-<version>.yaml` contains approved criteria, questions, evidence checklists, and the model's scoring method.
- `pqcmm-self-assessment-profile-<version>.yaml` configures subject fields, status choices, evidence limits and validator identifiers, assurance profiles, report behavior, and the boundary of future PKI Consortium services.
- JSON Schemas validate both contracts. Released model wording remains immutable even when the tool profile advances.

The browser tool resolves a generic assessment experience and registered scoring strategy from the profile. `weighted-average` and `cumulative-gates` are methodology implementations, not PKIMM or PQCMM branches. Shared runtime code owns profile validation, evidence hashing, attachment packaging, integrity metadata, and the assessment credential envelope. It does not evaluate executable expressions from YAML. New assessments select an existing experience and methodology through data; they need code only when they introduce a genuinely new interaction or scoring method.

The implementation keeps these responsibilities separate: model adapters parse source data, methodologies calculate results, subject-policy modules validate scope, report components render sections, format adapters prepare PDF or VC signing input, and remote-signing adapters call providers such as CSC. Profiles select these capabilities and their policy parameters. Provider calls, PDF construction, VC securing, evidence review, and model parsing must not be combined into one assessment-specific service.

The standalone [`pkic/pqcmm`](https://github.com/pkic/pqcmm) repository is the canonical home for the approved model, profile, and their schemas. pkic.org pins a release tag and the expected asset digests in `data/pqcmm.yaml`, resolves the required assets through the GitHub release API, and requires both GitHub's reported digest and the downloaded bytes to match the reviewed SHA-256 values. The site then publishes those verified bytes at `/wg/pqc/pqcmm/data/`.

Hugo generates the six level pages at build time through `content/wg/pqc/pqcmm/levels/_content.gotmpl`. Page titles, descriptions, summaries, criteria, assessment questions, guidance, evidence checklists, ordering, and canonical paths come from the released model YAML. The levels index uses the same data. pkic.org therefore does not maintain shadow copies of normative level content or generated Markdown. Site-specific overview, adoption, assessment, and certification guidance remains authored in pkic.org because it is website content rather than versioned model content.

## Version Policy

- Released model criteria and assessment questions are immutable.
- Corrections or substantive wording changes require a new model version, review, and approval.
- Stable criterion and question identifiers must not be reused for different meanings.
- Saved and exported assessments record the exact PQCMM data version.
- An assessment created for a different PQCMM version is not silently migrated. A future migration must be explicit and preserve the source record.
- Candidate improvements are recorded in `docs/pqcmm-next-version-issues.md` until a new version is approved.

## Report and Evidence Boundary

Assessment state and uploaded files stay in browser IndexedDB. Portable JSON exports use the model-neutral `pkic-assessment-package` schema and include evidence bytes so they can be restored offline. The package contains a W3C VC-shaped `AssessmentCredential` and its evidence attachments. Browser-created credentials are explicitly marked `unsecured-draft`; they are not conforming secured VCs until a trusted issuer applies a supported proof. PDF reports embed the package plus each evidence file as a PDF attachment. The package records the model and profile versions, claimed result, responses, evidence-review status, embedded filename, media type, byte size, and SHA-256 digest.

Evidence bytes are therefore included, not merely their hashes. Screenshots are currently PDF attachments rather than inline report images. SHA-256 detects alteration but does not prove that evidence is authentic, relevant, or sufficient. Self-assessment evidence is explicitly marked `provided-not-reviewed`; a later review service can record human or AI-assisted findings without silently upgrading the original claim.

## Solution Identity

A PQCMM result must identify the assessed vendor solution in a form inventory systems can consume. The PQCMM profile therefore requires at least one canonical CPE 2.3 name or package URL (pURL), while allowing both. Export is blocked until this profile rule is satisfied.

The assessment credential exposes these as separate, named properties:

```json
{
  "credentialSubject": {
    "identifiers": {
      "cpe": "cpe:2.3:a:example:product:1.0.0:*:*:*:*:*:*:*",
      "purl": "pkg:maven/org.example/product@1.0.0"
    }
  }
}
```

Consumers do not need to scan a generic identifier array or infer identifiers from vendor and product labels. The generic profile contract supplies the field formats and `at-least-one` rule; the runtime does not contain a PQCMM model-ID branch.

## Assurance and Signing

The browser issues only a self-assessment. It cannot label an assessment as qualified third-party or PKI Consortium certified. Those assurance profiles exist in the versioned profile as `external-workflow` states so later services can implement them without changing the meaning of existing reports.

The assessment does not record a proposed signer. The profile defines optional approval roles and PDF signature-field names, while the external signing workflow selects the actual signers at signing time. The current profile provides optional fields for a CEO or accountable executive and a CISO or security executive, and permits the signing workflow to add more signatures. This avoids invalidating the assessment when a delegate or executive changes at the last minute. The durable report text does not claim that a field is unsigned because that statement would become false after signing. A wallet presentation can help identify a signer, while organizational authority and the document signature remain separate checks.

The machine-readable credential draft carries the approval policy, not speculative signer identity. A completed signing or submission workflow should record the actual signer identity, organization binding, role-authority evidence, signature validation result, and trusted time as separate verification results. Optional PDF fields mean that a report can be generated before the organization decides whether one or several approvals are appropriate; they do not make a populated signature optional once a relying-party policy requires that approval role.

Assurance is represented as independent facets rather than one mandatory credential stack: signer identity, organization binding, role authority, document signature, trusted time, evidence review, assessor qualification, and certification issuance. Each external assurance profile declares the facets it requires. This supports a low-friction browser-created self-assessment while allowing procurement, audit, or certification policies to demand stronger combinations.

A natural-person signing certificate may contain `organizationName` or `organizationIdentifier`, but that association must not be treated as proof of the signer's current role or authority. Accepted authority evidence can include:

- a vLEI Official Organizational Role credential for an official representative;
- a vLEI Engagement Context Role credential for a functional or delegated role;
- a suitable EUDI Wallet organizational or mandate credential;
- authority verified manually against reliable organizational records.

vLEI is therefore a strong authority signal, but not a universal adoption prerequisite. The report records which assurance facets and evidence were actually validated.

The Cloud Signature Consortium API can authorize a multi-signature transaction over multiple document digests. `signatures/signHash` returns one signature value for each submitted hash, in corresponding order. One authorization ceremony can therefore cover the prepared PDF signing input and the prepared VC signing input when the same credential is legitimately used for both. One raw signature cannot cover two different hashes, and CSC does not by itself turn those values into PAdES and VC containers. Format-specific components remain responsible for PDF ByteRange/CMS construction and the selected VC securing mechanism.

The report profile currently targets PAdES B-LTA. Trusted time may initially be supplied by a signature time-stamp or a PDF document time-stamp. B-LT adds the validation material needed for later validation; B-LTA adds document time-stamps that protect that material over the long term. An electronic seal can contain its own signature time-stamp, but later document time-stamps can still be needed to preserve validation through certificate expiry or algorithm change. A document time-stamp proves that document bytes existed by a time; on its own it does not prove an executive's identity, authority, or approval.

A future PKI Consortium service may charge a processing fee covering intake, human and AI-assisted evidence review, qualified assessor checks, remote PAdES signing, VC issuance, publication, status service, and long-term storage. Submission should use a Verifiable Presentation that can combine the assessment credential, signer identity and authority credentials, evidence credentials, and auditor credentials. PKI Consortium certification should be a separate credential referencing the reviewed assessment rather than a mutation of the original self-assessment.

## Future Assessment Families

The shared profile contract distinguishes `maturity`, `knowledge-diagnostic`, and `certification-exam` families. A self knowledge assessment can reuse the profile, evidence, export, and report foundations. A formal certification exam remains a separate policy engine because it requires protected question banks, randomization, attempt controls, proctoring, and psychometric governance.

## Standards References

- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [Cloud Signature Consortium API specifications](https://cloudsignatureconsortium.org/resources/download-api-specifications/)
- [GLEIF vLEI Ecosystem Governance Framework](https://www.gleif.org/en/organizational-identity/become-a-vlei-issuer-qvi/vlei-ecosystem-governance-framework)
- [ETSI EN 319 142-1 V1.2.1, PAdES baseline signatures](https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/01.02.01_60/en_31914201v010201p.pdf)
- [ETSI EN 319 412-2, certificate profile for natural persons](https://www.etsi.org/deliver/etsi_en/319400_319499/31941202/02.04.00_20/en_31941202v020400a.pdf)
