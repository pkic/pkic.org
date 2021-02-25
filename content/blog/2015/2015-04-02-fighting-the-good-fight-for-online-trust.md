---
authors:
- CA Security Council
date: "2015-04-02T19:47:41+00:00"
dsq_thread_id:
- 3649974504
keywords:
- casc
- caa
- mitm
- mozilla
- apple
- hsm
- root program
- webtrust
- misissued
- cps
- ssl
- https
- google
- policy
tags:
- CASC
- CAA
- MITM
- Mozilla
- Apple
- HSM
- Root Program
- WebTrust
- Mis-issued
- Policy
- SSL/TLS
- Google
title: Fighting the Good Fight for Online Trust


---
Once again Browsers and Certificate Authorities are in the news over the reported mis-issuance of an SSL server certificate to a google.com domain. Discovered by Google most likely via technology known as key pinning and discussed by Google’s Adam Langley in this [blog][1], a Chinese certificate authority, CNNIC (Chinese Internet Network Information Center), apparently issued an intermediate certificate to an Egyptian company called MCS Holdings. Because the CNNIC root certificate is included in the root store of most major browsers, users would not see any warnings on sites that have certificates issued by CNNIC or MCS Holdings. When MCS installed their intermediate into a Man in the Middle (MITM) proxy device, that device could then issue certificates for sites which users connected to that proxy would visit. (MITM is described in more detail in our previous blog here: <https://casecurity.org/2015/01/08/gogo-found-spoofing-google-ssl-certificates/>)

There are several violations of the CA/B Forum Baseline Requirements and Mozilla Root Program Requirements here. First, Mozilla specifically prohibits using public roots for MITM applications. Second, any sub CA certificates (issued from the Root) must be publicly disclosed and audited or be technically constrained(using the technology known as “name constraints” which limits the domains which the CA can issue to_)_. Neither appears to be the case here. Third, indications are that the key was not generated and stored in a proper Hardware Security Module (HSM). There are several other mistakes as well but these are the major ones. 

CNNIC claims the sub CA certificate was only issued for a short duration and was to be used for test purposes only. This is hardly comforting as the impact of the misuse of such a certificate is clear. Users can be deceived to go to a fraudulent website and have their credentials stolen. The fact that bogus certificates found their way onto the public Internet due to this “test” makes it clear that improper controls were in place at both CNNIC and MCS Holdings as well as a poor understanding of the rules surrounding public CAs. 

The major browsers quickly moved to un-trust the MCS Holdings certificate to protect their users from potential fraud. MCS sent a report to Mozilla with their [assessment][2] of the [situation][3]. Mozilla is exploring options for dealing with both CNNIC and MCS. While some community members would like to see the immediate removal of the CNNIC root certificate, others have called for a more moderate stance in light of the detailed report and cooperation shown by the parties. Examples are: (1) remove EV treatment for CNNIC roots, (2) constrain the CNNIC roots to certain domains (i.e. .cn or .china) and (3) force CNNIC to implement Certificate Transparency technology and update their systems to enable certs with name constraints, followed by a re-audit. 

Recently introduced technologies and controls such as Certificate Transparency (CT), Certificate Key Pinning (HPKP), and Certificate Authority Authorization (CAA) will help restore trust in the CA/Browser cryptography system by detecting such an issue quickly. CT and HPKP are being implemented by some browsers and CAA is a function that CAs will have to deploy.

Where does the CASC stand in all of this? Clearly CNNIC broke the rules and got caught. Whether it was intentional or not is a matter of debate. We have seen previous instances of this with TurkTrust and ANSSI, for example. Both cases were handled very differently due to the circumstances. We would encourage Mozilla and the rest of the browser community to hear all sides of this case before passing judgment, just as they have done in prior cases. The CASC members have pledged to uphold high standards with regard to all the ecosystem rules including CA/B Forum Baseline Requirements, Network Security controls, and Mozilla, Microsoft, Google, Apple and other root program requirements. We all have strict controls in place to insure sub CA certificates are either disclosed or constrained, have strong and knowledgeable vetting and authorization teams, obtain regular audits from accredited WebTrust auditors and work closely with the major browser vendors in the CA/B Forum. While some CASC members do issue sub CA certificates to third parties, they are well aware of the strict rules surrounding this practice and the need to remain vigilant. The CASC supports the use of CT, CAA, and HPKP technologies and urges adoption by all participants in the ecosystem.

**April 5, 2015 Update:** [Google](http://googleonlinesecurity.blogspot.com/2015/03/maintaining-digital-certificate-security.html) has announced that they are taking action to distrust the CNNIC root certificates. This is essentially a punishment for violating the Baseline Requirements and the Mozilla root program rules. Google will “whitelist” all existing CNNIC certificates and has provided a path for re-inclusion into their browser by insisting all future certificates use Certificate Transparency. [Mozilla](https://blog.mozilla.org/security/2015/04/02/distrusting-new-cnnic-certificates/) was more explicit, stating, “The Mozilla CA team believes that CNNIC’s actions amount to egregious behavior, and the violations of policy are greater in severity than those in previous incidents. CNNIC’s decision to violate their own CPS is especially serious, and raises concerns that go beyond the immediate scope of the misissued intermediate certificate.”  Firefox will be updated to distrust any CNNIC certificate with a notBefore date of April 1, 2015. The current CNNIC root will remain in the Mozilla root store to validate current certificates and CNNIC can reapply for full inclusion but may be subject to additional scrutiny and controls during the process. Microsoft is still evaluating whether to take further action than just distrusting the MCS Holdings Intermediate certificate. No word from Apple so far.

 [1]: http://googleonlinesecurity.blogspot.com/2015/03/maintaining-digital-certificate-security.html
 [2]: https://pzb-public-files.s3-us-west-2.amazonaws.com/B1.pdf
 [3]: https://pzb-public-files.s3-us-west-2.amazonaws.com/B2.pdf