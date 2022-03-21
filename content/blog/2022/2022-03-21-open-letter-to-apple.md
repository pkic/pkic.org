---
title: An open letter to Apple
summary: We would like to thank and also invite Apple to work more closely with organizations such as the CA/Browser Forum, ETSI and the PKI Consortium to address its concerns, work towards harmonization of policies and to support standardized automation in its software before making any changes on its own. This is because unilaterally enforced policies, especially those that go beyond your own root program, can have a disproportionate impact on PKI implementations, its relying parties and the entire ecosystem. 
authors: [PKI Consortium]
date: 2022-03-21T15:00:00+00:00
categories:
tags: [PKIC, Apple]

---

Dear Apple,

The members of the PKI Consortium would like to respond to the policy changes you have announced in the [Apple Root Certificate Program](https://www.apple.com/certificateauthority/ca_program.html).

As a consortium we share the desire for better agility in the PKI ecosystem and we appreciate that Apple is trying to help the industry with this transition. 

We would like to thank and also invite Apple to work more closely with organizations such as the CA/Browser Forum, ETSI and the PKI Consortium to address its concerns, work towards harmonization of policies and to support standardized automation in its software before making any changes on its own. This is because unilaterally enforced policies, especially those that go beyond your own root program, can have a disproportionate impact on PKI implementations, its relying parties and the entire ecosystem. 

In regard to the specific announced policy changes, some of our members, those that deal with S/MIME certificates on hardware cryptographic devices (e.g., smartcards, tokens), foresee that the proposed changes pose significant challenges in the continuous use of these certificates, the strong protection of private keys, and therefore their use within organizations. Hardware token based S/MIME certificates are widely used in public administration and large private businesses and not so much by private individuals.

We ask you to look over the opinions of these parties, which we have set out in the appendix of this letter. The members of the consortium really value your feedback and invite you to exchange thoughts about the available options to develop the most secure, agile and efficient process possible, taking into account the interests of various participants.

Kind regards,

PKI Consortium


## Appendix

First, we really appreciate the change you made to expand the validity period up to 1185 days from 825 previously. In your communication you stated that the Apple Root Program plans to continue working towards shorter validity S/MIME.

During a meeting of the CA/Browser Forum you indicated the importance of policy agility and the automation of certificate provisioning ([[Smcwg-public] Approved Minutes of SMCWG October 14, 2021 (cabforum.org)](https://lists.cabforum.org/pipermail/smcwg-public/2021-November/000205.html)). We support Apple’s concerns on crypto agility but would like to see that instead of more restrictive policies, better (native) and harmonized tooling would be provided to increase the agility of the PKI ecosystem. 

We agree that shortening the S/MIME-certificate validity period is desirable for certificates where the private key is located in software and used for signing. Shorter validity periods for S/MIME certificates of which the private key is protected by a hardware cryptographic module or that are used for encryption can have a disruptive impact within the current state of the ecosystem.

Usually, the S/MIME-certificates have a validity of at least 3-5 years when issued on hardware such as tokens and smart cards. In our opinion, a validity period for certificates (where the private key is protected in hardware) of fewer than three years is currently not practically feasible, it requires complex solutions for re-issuing on the same cryptographic device and re-distributing the public key for encryption purposes.

Due to the lack of remote key attestation support by hardware vendors ([see also our project on this topic](https://pkic.org/2021/08/03/increasing-support-and-awareness-for-remote-key-attestation/)) and the limited tooling in mail software and the operating systems, secure automation is not always possible. Many users for S/MIME are restricted by policy requirements and regulations such as from local governments, industry bodies, or eIDAS in Europe that require the use of secure issuance processes (such as physical presence) and qualified hardware (such as a Qualified Signature Creation Device).

While a hybrid solution, using existing keys in hardware cryptographic devices for certificate renewal seems feasible, this currently requires custom middleware that needs to be developed, deployed and maintained for all types of end-user devices and might create an unintended dependency on specific vendors and/or trust service providers, limiting the agility from a different perspective.

If automation was technically feasible in a standardized way, Registration Authority (RA) systems and processes must be re-architected to include remote key attestation, remote identity proofing, and the provisioning on hardware. Then this new architecture and process needs to be developed (which might include external vendors), tested, and re-certified, a process that takes at least a whole audit cycle, not considering the adoption and implementation in subscriber environments.

These changes will cause significant technical, organizational, and certification problems for organizations relying on S/MIME technology. It will reduce the use of secure S/MIME certificates that are protected by hardware cryptographic modules, especially in enterprise-, governmental and healthcare environments.

Until automation is feasible to implement, organizations that rely on S/MIME technology will see the work and cost of qualified personnel increasing significantly. There is also a concern that the additional load by the frequent re-issuance can result in less strengthened procedures by less experienced officers.

Within the EU, Trust Service Providers who wish to issue qualified certificates on cryptographic hardware in compliance with the eIDAS legislation (see Article 30, 39, and Annex 2 eIDAS 910/2014) are prescribed to use Qualified Signature Creation Devices (QSCD) such as Smart Cards, Tokens and/or HSMs. This is included in the implementing act CID 2016/650, which specifies requirements such as EN 419 241-2, ISO/IEC 15408 1-2-3, EN 419 221-5 and EN 419 211 concerning the Protection profiles. The cryptographic hardware modules are subject to strict certification requirements and are a very safe means for key material. 

As stated previously, we would like to see more agility in the S/MIME ecosystem, but do not agree that this can simply be solved by stricter policies. Instead, the current proposal will weaken the security of the S/MIME ecosystem and further limit the adoption. Assuming that the confidentiality of private keys is the biggest risk to S/MIME signature trust, shortening the lifespan of S/MIME certificates adds little security benefits when the corresponding private keys reside on a hardware cryptographic module.

The members of the PKI Consortium are proponents of a more risk-based approach to Apple’s proposal and would like to see a distinction in S/MIME certificate lifespan based on whether a hardware cryptographic module was used or not.