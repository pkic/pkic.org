---
title: What is Certification Authority Authorization?
authors: [Rick Andrews]
date: 2013-09-25T17:00:11+00:00
dsq_thread_id:
  - 1938190411


---
DNS Certification Authority Authorization (CAA), defined in IETF draft [RFC 6844](http://tools.ietf.org/html/rfc6844), is designed to allow a DNS domain name holder (a website owner) to specify the certificate signing certificate(s) authorized to issue certificates for that domain or website. Usually, the certificate signing certificate will belong to the Certification Authority (CA) that issues SSL certificates to you. It&rsquo;s a way for you to indicate which CA or CAs you want to issue certificates for your domains. Using CAA could reduce the risk of unintended certificate mis-issuance, either by malicious actors or by honest mistake.

For example, if you own example.com, and wish to express your preference that certificates for that domain should only be issued by Primary CA, you would create a CAA record in DNS indicating such. If a malicious actor, or an employee who is not aware of your preference, engages a different CA, Secondary CA, to purchase a certificate for example.com, Secondary CA might first check in DNS. If they see that you have a CAA record that does not specify Secondary CA as an allowed certificate issuer, Secondary CA could alert you of that. You could then choose to deny the certificate purchase, or change or add a CAA record to DNS to allow Secondary CA to issue certificates for your domain.

### Advantages

CAA is a simple way to express your preference of CAs. Since you own your domain name and control all DNS information for that domain, you can add CAA information to DNS, and change it when you wish. No other party, including the CA, needs to be involved.

If you are responsible for your company&rsquo;s certificate infrastructure, you may benefit by using CAA. For example, you may have negotiated a volume discount with a particular CA, and wish to purchase all your certificates from that CA to save money. With CAA, you may be alerted when an employee enrolls for a certificate from a different CA.

CAA also includes a feature that enables CAs to report invalid certificate requests. Any compliant CA could notify you via email, web service, or both, about any certificate request they received that did not match the preference you set in your CAA record.

If you use CAA, you&rsquo;re not tied to one CA. It&rsquo;s possible to create multiple CAA records for multiple CAs that you wish to do business with. Or you can use CAA to specify that no CA should issue certificates to your domain.

### Disadvantages

There are several disadvantages of CAA to be aware of:

Compliance with CAA is voluntary. CAs are not required to check for a CAA record or comply with its contents if they do, unless otherwise expressed in their Certification Practices Statement (CPS).  In other words, a CA could still ignore your CAA record, as long as it conforms to statements made in its CPS about CAA compliance.  At the time of this writing, no CA has announced support for CAA; however, a few public CAs are beginning to test it.

CAA is currently only a partial security solution because attackers have ways of subverting DNS, and although Domain Name System Security Extensions (DNSSEC) can secure your CAA record within DNS, DNSSEC is not widely deployed at this time.  CAA will also need to be widely implemented and observed among CAs, so the use of DNSSEC is not mandatory with CAA to avoid unnecessary dependency on full DNSSEC deployment.

It may be difficult for you to make changes in your DNS information. You may have to engage other people within your company or an external vendor to make the necessary changes.

It may slow down certificate issuance if a compliant CA checks your CAA record and determines that it is not specified in that record. The CA may want you to update your CAA record before issuing the certificate, or may wish to get a waiver from you approving the certificate issuance.

### Conclusion

CAA is a new, relatively low-cost approach to preventing certificate mis-issuance, although it&rsquo;s not foolproof. Several CAs are examining how to implement support for CAA within their certificate issuance systems.  By itself, CAA does not provide high levels of security, but it might be appropriate as one of many tools in your toolkit to protect your domain name, website, and brand.