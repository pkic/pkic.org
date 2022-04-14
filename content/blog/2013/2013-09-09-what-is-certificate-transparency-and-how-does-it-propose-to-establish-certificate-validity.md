---
authors:
- CA Security Council
date: "2013-09-09T15:00:52+00:00"
dsq_thread_id:
- 1942941130
keywords:
- timestamp
- tls
- revocation
- ssl
- mis-issued
- attack
- ocsp
tags:
- TSA
- SSL/TLS
- Revocation
- Mis-issued
- Attack
- OCSP
title: What Is Certificate Transparency and How Does It Propose to Address Certificate Mis-Issuance?
aliases:
- /2013/09/09/what-is-certificate-transparency-and-how-does-it-propose-to-establish-certificate-validity/

---
As originally architected by Netscape and others in the mid-1990s, the certificate issuance process envisioned that the CA would present the certificate and its contents to the named subject who would review and accept the certificate first. Then the CA would publish the certificate to a repository. That process would establish that the certificate’s subject was aware of certificate issuance. (Otherwise, an unscrupulous CA could sign a subscriber’s public key and create a certificate for the subscriber without its knowledge.) The repository was also an independent means of obtaining and verifying the public key prior to initiating secure, authenticated communication without having to obtain it solely from the server during session negotiation. 

Certificate Transparency proposes a new way of publicizing certificate issuance and provides brand owners and their online customers with a method of identifying a certificate that has not been properly issued. A CA creates what is called a “pre-certificate” and sends it to a Log Server that keeps track of the certificate contents before the certificate is officially issued by the CA. The logging service returns a “signed certificate timestamp” (SCT) to the CA, which can either be embedded in the official certificate or provided by other means. See [http://tools.ietf.org/html/rfc6962#section-3](http://tools.ietf.org/html/rfc6962#section-3). The SCT serves as a kind of pointer to where that certificate was registered in the log, thereby establishing that the CA published the certificate as evidence for review. 

As currently envisioned, the Certificate, the SCT, and the Log will be checked by various components of a full system:

- Browser software will check to see if a valid SCT exists — either in the certificate, stapled OCSP response, or elsewhere. It will check the digital signature on the SCT. Eventually some browsers might check the timestamps on SCTs before allowing an SSL/TLS connection.
- A special Log verification system known as an Auditor will verify log integrity — i.e., that Logs contain all Certificates and have not been compromised. Otherwise, a compromised Log will go undiscovered and the SCTs themselves would be unreliable. This might be done by browsers for SCTs encountered by users or by other independent third parties.
- Another type of system known as a Monitor watches for malformed or unexpected certificates in Logs and will over time examine every certificate in a Log. Domain owners, CAs, or domain registrars on behalf of domain owners, will use Monitors to check all log servers to discover whether any new certificates have been issued for a particular domain. (If a domain owner does not have a means of monitoring the logs, then a mis-issued certificate might go undiscovered.)
- Auditors and Monitors will exchange information about logs through a Gossip protocol. This asynchronous communication path helps detect Logs trying to display inconsistent views to different observers. See [http://www.certificate-transparency.org/how-ct-works](http://www.certificate-transparency.org/how-ct-works).

The model outlined above, however, raises important issues about the efficacy of the system in light of the added expense and complexity in what some would say is an already complex SSL environment — especially if the added infrastructure is required for all domains while the primary targets of attack are a relative few domains. Other unresolved issues involve the duties and rights of parties who maintain or review logs — who is the party responsible for operating the logs and what are their legal obligations, how many are required, who should have authority to examine and search the logs, and what are their legal obligations? 

As the number of required log servers increases, so does the delay in obtaining the certificate as more SCTs are expected to be returned for each certificate. Some have suggested that if a certificate were to include three or four embedded SCTs (in order to provide resiliency in case of log failure), then this requirement would not only slow down CA systems, but also browser processing. Others respond by noting that the certificate verification process will not slow down because only one SCT is needed to ensure that CT was followed, and the browser can check SCTs from those it has cached. 

We definitely need systems that provide better public accountability of certificate issuance by CAs and enable organizations to know about the certificates issued under their brands. Certificate Transparency is not a replacement for revocation checking, so a potential benefit is that we can experiment with CT and improve upon it without interfering with existing infrastructures or limitations — and supplement existing methods of revocation checking. Thus, if Certificate Transparency demonstrates its usefulness as a certificate information tool, then it has promise as an additional security measure to augment other new ones, such as OCSP Stapling and Pinning.
