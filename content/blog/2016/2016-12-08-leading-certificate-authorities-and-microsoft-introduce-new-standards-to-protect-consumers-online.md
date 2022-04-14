---
authors:
- CA Security Council
categories:
- Press Releases
date: "2016-12-08T21:05:41+00:00"
dsq_thread_id:
- 5366004868
keywords:
- tls
- casc
- fips
- time-stamping
- revocation
- tsa
- hsm
- malware
- ssl
- code signing
- identity
- microsoft
- certificate authority security council
tags:
- SSL/TLS
- CASC
- FIPS
- TSA
- Revocation
- HSM
- Malware
- Code Signing
- Identity
- Microsoft
title: Leading Certificate Authorities and Microsoft Introduce New Standards to Protect Consumers Online

---
<h3 style="text-align: center; margin-bottom: 1em;">
  The CASC’s Minimum Requirements for Code Signing Certificates enables a common vetting process for all CAs
</h3>

**San Francisco –December 8, 2016 –** the Certificate Authority Security Council (CASC), an advocacy group committed to the advancement web security, today announced the Code Signing Working Group has released new Minimum Requirements for Code Signing for use by all Certificate Authorities (CA). These requirements represent the first-ever standardized code signing guidelines. Code signing is the method of using a certificate-based digital signature to sign executables and scripts in order to verify the author’s identity and ensure that the code has not been changed or corrupted. Helping to verify software authenticity and avoid downloading malware and other malicious software is critical to protecting consumers’ online interactions. Microsoft is the first applications software vendor to adopt these guidelines, with others expected to follow.

The Code Signing Working Group was created as a voluntary group of CAs, Internet browser software vendors, and suppliers of other applications that use X.509 v.3 digital certificates for SSL/TLS and code signing. Once the code signing draft was completed, it was endorsed by the CA Security Council members and others.  The CA Security Council website is now the repository for the document and the group will continue to work with others in the industry to ensure it is kept up to date.

“Previously, there were no standards, which meant that if one CA rejected a company’s application, that company could submit the same application to a different CA,” said Dean J. Coclin, Senior Director, Business Development, Symantec. “The Minimum Requirements for Code Signing will improve all CAs’ ability to identify the publishers and authenticate that the code is unchanged.”

The guidelines include several new features that will help businesses defend their IT systems and information stores from cyber-attacks, including:

  * **Stronger protection for private keys:** The best practice will be to use a FIPS 140-2 Level 2 HSM or equivalent. Studies show that code signing attacks are split evenly between issuing to bad publishers and issuing to good publishers that unknowingly allow their keys to be compromised. That enables an attacker to sign malware stating it was published by a legitimate company. Therefore, companies must either store keys in hardware they keep on premise hardware, or in a new secure cloud-based code signing cloud-based service.
  * **Certificate revocation:** Most likely, a revocation will be requested by a malware researcher or an application software supplier like Microsoft, if they discover users of their software may be installing suspect code or malware. After a CA receives request, it must either revoke the certificate within two days, or alert the requestor that it has launched an investigation.
  * **Improved code signatures time-stamping:** CAs must now provide a time-stamping authority (TSA) and specifies the requirements for the TSA and the time-stamping certificates. Application software suppliers are encouraged to allow code signatures to stay valid for the length of the period of the time-stamp certificate. The standard allows for 135-month time-stamping certificates.

Microsoft will require CAs that issue code signing certificates for Windows platforms must adhere to these guidelines beginning on February 1, 2017.

“The combined versions of Microsoft’s Windows platform represent [nearly 90 percent][1] of the desktop operating system market share, so its decision to mandate that CAs follow the new requirements is significant,” said Jeremy Rowley, Executive Vice President of Emerging Markets, DigiCert. “We expect Microsoft will serve as the catalyst for other application software suppliers to do the same.”

“Microsoft is committed to continuously improving the security of our products and services. These new baseline requirements will further our goal by ensuring that our certificate authority partners follow a standard set of rules when issuing certificates to software developers,” said Jody Cloutier, Senior Security Program Manager, Microsoft Cryptographic Ecosystem.

###  Resources:

[Code Signing Endorsement][2]

[Code Signing White Paper][3]

## Connect with CASC

  * [Follow CASC on Twitter][4]
  * [Join the CASC LinkedIn Group][5]
  * [View Presentations on SlideShare][6]
  * [Subscribe to CASC News RSS Feed][7]
  * [Meet the Members of the CASC][8]
  * [Visit CASC Website][9]

## About the CASC

The Certificate Authority Security Council is comprised of leading global Certificate Authorities that are committed to the exploration and promotion of best practices that advance trusted SSL deployment and CA operations as well as the security of the internet in general. While not a standards-setting organization, the CASC works collaboratively to improve understanding of critical policies and their potential impact on the internet infrastructure. More information is available at [https://casecurity.org][10].

 [1]: https://www.netmarketshare.com/operating-system-market-share.aspx?qprid=10&qpcustomd=0
 [2]: /uploads/2016/12/Code-Signing-Endorsement.pdf
 [3]: /uploads/2016/12/CASC-Code-Signing.pdf
 [4]: http://bit.ly/X3x9XB
 [5]: http://linkd.in/VSTWdR
 [6]: http://slidesha.re/Ye2dFf
 [7]: http://bit.ly/XE3xRS
 [8]: http://bit.ly/YXYhcP
 [9]: http://bit.ly/VQCIZc
 [10]: https://casecurity.org/
