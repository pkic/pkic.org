---
authors:
- Bruce Morton
date: "2014-03-28T14:00:37+00:00"
dsq_thread_id:
- 2526284372
keywords:
- pki
- ssl
- microsoft
- ocsp
- mitm
tags:
- PKI
- SSL/TLS
- Microsoft
- OCSP
- MITM
title: Certificate Reputation


---
One of the advantages of having multiple certification authorities (CAs) from which to choose an SSL certificate is that customers have flexibility to choose a CA that meets their specific needs, or even use a number of CAs for redundancy or to have access to a broader toolset. The disadvantage for end users, however, is that they often may not know if a particular CA was authorized to issue the certificate, and there could be a chance that the certificate was fraudulently obtained.

Security experts have come out with proposals to allow domain owners to authorize CAs ([Certification Authority Authorization][1]), allow the Web server to state which public key is trusted ([Public Key Pinning][2]), or allow the owner of a website to monitor certificates that have been issued for their domain ([Certificate Transparency][3]).

Microsoft is proposing a solution to improve trustworthiness of certificates: [Certificate Reputation][4]. In Internet Explorer (IE) 11, Microsoft will extend the telemetry collected by its SmartScreen Filter to include analysis of SSL certificates presented by websites. Microsoft is creating tools to build intelligence about all certificates issued by every trusted root CA.

One goal of this effort will be to flag potential man-in-the-middle (MITM) attacks where the site uses publicly trusted certificates from public CAs. Examples of warning flags might include:

  * Website has been issued a subordinate CA certificate capable of issuing other SSL certificates
  * Website presents a different certificate in only certain regions
  * Significant change in the fields of a certificate that a CA usually issues, such as the OCSP responder location

Currently, Google and Microsoft are each advancing their own non-conflicting solutions to certificate trust. Google is promoting Certificate Transparency (CT) as a solution — looking to require CAs to support CT for EV SSL certificates in 2015. This dual approach by these two companies may be good for the public from a defense-in-depth perspective. For comparison, Certificate Reputation supports the following:

  * **Privacy** – When a certificate subscriber purchases a certificate for its internal domain name, this domain name will not be available publicly. Data will also be sent encrypted to Microsoft and no personally identifiable information is retained.
  * **Certificate Monitor** – Domain owners could be notified by email when new certificates are issued with their domain names.
  * **Scalable** – The Certificate Reputation solution is already being implemented and scales without requiring effort or cooperation from any third parties such as website operators or CAs. Microsoft can enhance functionality to its system as needed. 
  * **Deployment** – Similarly, Certificate Reputation should be easy to deploy as it will only require efforts from Microsoft. The solution will not rely on changes being performed by third parties such as CAs, subscribers, Web server developers, or OCSP developers.

Security experts also say there are some disadvantages:

  * **No Public Log** – Microsoft will own the database and it will not be made publicly available, nor available for audit.
  * **Sensitivity** – Attacks that are highly targeted may be difficult to detect.
  * **All Certificates Not Covered** – The solution will rely on the telemetry gathered by the use of IE 11 (and later). This means it is targeted at certificates that Microsoft browsers encounter and not other applications or browsers. There is also the opt-out issue, where an organization might not provide data back to Microsoft; in this case, the solution will be deprecated for those sites.

 [1]: https://casecurity.org/2013/09/25/what-is-certification-authority-authorization/
 [2]: https://casecurity.org/2013/08/28/public-key-pinning/
 [3]: https://casecurity.org/2013/09/09/what-is-certificate-transparency-and-how-does-it-propose-to-establish-certificate-validity/
 [4]: https://blogs.technet.com/b/pki/archive/2014/02/22/a-novel-method-in-ie11-for-dealing-with-fraudulent-digital-certificates.aspx