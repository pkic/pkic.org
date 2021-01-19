---
title: Minimum Requirements for Code Signing Certificates
authors: [Bruce Morton]
date: 2016-07-20T20:47:02+00:00
dsq_thread_id:
  - 5001214862


---
It is time for an update on the Baseline Requirements for Code Signing.

First the bad news, the new standard was not approved by the CA/Browser Forum due to philosophical differences among some forum members who felt code signing was not in scope with the Forum’s charter.

The good news is the document was created in a multi-stakeholder environment and substantially improves the current management processes. As such, it was decided to bring the document outside of the forum and finalize it as part of the CA Security Council. The CASC members and others will continue to enhance and manage the document. [Microsoft also supports the document and has added the requirement][1] to use the new standard for code signing certificates by February 1, 2017.

As the document has been pulled away from the CA/Browser Forum, it has also been renamed “[Minimum Requirements for the Issuance and Management of Publicly-Trusted Code Signing Certificates][2]” and can be found on the CA Security Council site.

With implementation of the Minimum Requirements for Code Signing, we will see a requirement for a higher protection of the private key. Studies have shown that code signing attacks are split 50/50 between issuing to bad publishers and issuing to good publishers which have their key compromised. If you have your key compromised, then the attacker can sign malware stating it was published by your company. As such it is best to protect your private key and the best practice will be to use a FIPS 140-2 Level 2 HSM or equivalent. If you use a lower standard of key protection and get compromised, then your CA will be forced to move you to the higher level.

The Minimum Requirements also added a process for revocation where various parties can ask for a certificate to be revoked. Most likely, a revocation will be requested by a malware researcher or an application software supplier, such as Microsoft, where users of their software may be installing suspect code or malware. In this case, if Microsoft were to ask the CA to revoke the certificate, then within two days the certificate be must revoked or Microsoft must be informed that the CA has started an investigation.

Time-stamping of code signatures has also been improved. The standard requires the CA to provide a time-stamping authority (TSA) and specifies the requirements for the TSA and the time-stamping certificates. Application software suppliers are encouraged to allow code signatures to stay valid for the length of the period of the time-stamp certificate. The standard allows for 135 month time-stamping certificates, so your code signing signature could be valid for more than 10 years.

The Minimum Requirements for Code Signing will improve the capability to identify the publisher and authenticate that the code is unchanged.

 [1]: http://social.technet.microsoft.com/wiki/contents/articles/31633.microsoft-trusted-root-program-requirements.aspx
 [2]: /uploads/2016/09/Minimum-requirements-for-the-Issuance-and-Management-of-code-signing.pdf