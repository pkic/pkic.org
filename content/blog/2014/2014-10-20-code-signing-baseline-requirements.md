---
authors:
- Jeremy Rowley
date: "2014-10-20T17:00:00+00:00"
dsq_thread_id:
- 3132033613
keywords:
- casc
- vulnerabilities
- malware
- ca/browser forum
- code signing
- microsoft
tags:
- CASC
- Vulnerability
- Malware
- CA/Browser Forum
- Code Signing
- Microsoft
title: Code Signing Baseline Requirements


---
Code signing certificates are used to sign software objects to authenticate that they originated from a verified source, allowing developers to avoid warnings commonly displayed by application software vendors such as Microsoft operating systems and Java. A fraudulent code signing certificate can wreak havoc on networks, spreading malware and adware without restraint. Certificate Authorities are tasked with ensuring that code signing applicants are legitimate entities and provide accountability for use of the certificate.

Over the past few months, the CA/Browser Forum’s code signing working group developed a new standard for issuing code signing certificates. These standards are designed to combat the two most common forms of abuse–stolen private keys and fraudulent certificate applications. As stated in the requirements, the primary goal “… is to enable trusted signing of code intended for public distribution, while addressing user concerns about the trustworthiness of signed objects and accurately identifying the software publisher.”

These requirements, if adopted, will enhance operating systems, browsers and security software, and benefit developers and end users by globally improving object signing to ensure CAs follow a rigorous validation process that curtails falsified documentation, ensures entity legal existence, and verifies the authenticity of the code signing request. Examples of requirements include a face-to-face or notarized process for individuals and stringent requirements on key protection, especially for entities that have previously had their keys compromised. CAs are also required to educate subscribers on how to generate, store and protect their private keys in a secure manner, and what to do if they suspect their private key has been compromised.

Certificate problem reporting and investigation requirements help reduce the spread of malware by emphasizing the need for timely re-dress of compromised certificates. CAs will be required to publicly disclose instructions for reporting suspected private key compromise, key misuse, or any certificates used to sign suspect code. CAs also will be required to give priority to issues reported by security researchers in their attempt to combat vulnerabilities. CAs will track fraudulent requests and work on revising the requirements over time to improve the elimination of high-risk requests and reduce incidents of repeated misuse.

Members of the CA/Browser Forum working group are hoping to see the Baseline Requirements for Code Signing Certificates adopted around the beginning of next year and audit standards created soon after to ensure compliance among all code signing issuers. The CASC supports adoption of the guidelines and believes their implementation will lead to improved security throughout the Internet.