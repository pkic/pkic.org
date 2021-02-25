---
authors:
- Dean Coclin
date: "2014-03-12T19:00:43+00:00"
dsq_thread_id:
- 2404731137
- General
keywords:
- ov certificate
- ev certificate
- extended validation
- dv certificate
- domain validated
- ssl
- phishing
- encryption
tags:
- OV
- EV
- DV
- SSL/TLS
- Phishing
- Encryption
title: Think Twice Before Using DV for E-Commerce


---
In a previous blog ([What Are the Different Types of SSL Certificates?][1]), we described the various types of SSL certificates available from publicly trusted Certificate Authorities (CAs).  CAs are often asked by their customers which certificate type should be used for websites conducting E-Commerce, rather than for just encryption of sensitive data. For the latter case, a Domain Validated (DV) certificate will work fine. A DV cert allows for encryption to take place between the browser and the server. However, because DV certificates do not contain any identification information, they SHOULD NOT BE USED for E-Commerce.  Why? Let’s look deeper at the differences between these certificates.

**Figure A** shows the details of a Domain Validated certificate in Internet Explorer. Notice that there is no identification information included in the certificate other than the domain name. Why is that important to know? Let’s say you came across a retail site from a search engine that had the item you wanted to purchase at an unbelievably good price. You see the lock displayed in the browser bar and figure it has security, so it must be a real merchant. But wait; let’s click on that lock to see what it says about the merchant. If it’s a DV certificate, it says nothing; only that the site has the right to use that domain name1. How can you be sure it’s really the merchant you think it is?

[{{< figure src="/uploads/2014/03/2014-04-18_0854.png" title="Figure A: DV Certificate Details" >}}][2]

However, if it’s an Organizationally Validated (OV) or Extended Validation (EV) Certificate, more details about the merchant will be in the certificate because the CA has validated those items. The CA/B Forum guidelines state that only validated information can be contained within a certificate. Hence, anything seen in the certificate has been checked and verified by the issuing CA.  **Figure B** shows an example of an EV cert with the details of the organization highlighted. **Figure C** shows the details of an OV certificate. Note the extended details provided by an EV certificate, further enhancing the business legitimacy to the consumer.

Returning to our example of that great price you found for an item on the Internet, and were referred to a website you’ve never used before, which would you rather see:  A site that uses a DV certificate to encrypt your credit card and personal details, or a site that uses OV/EV with verified business info in the certificate? The latter is preferable and should be the minimum for E-Commerce.

{{< figure src="/uploads/2014/03/ev-for-e-commerce-b.jpg" title="Figure B: EV Certificate showing verified detailed merchant information" >}}

{{< figure src="/uploads/2014/03/ev-for-e-commerce-c.jpg" title="Figure C: OV Certificate showing verified merchant details" >}}

CA’s are required to perform diligence to ensure that information in OV and EV certificates is accurate. Hence, in these types of certificates, attributes such as business name, location, address, incorporation or registration information have been checked by the CA. The same is not true for DV certificates. Consumers browsing unfamiliar retail sites can use information in OV/EV certificates to obtain more assurance about the legitimacy of the site.  EV provides even greater information than OV which is an excellent choice for highly phished sites.  DV is an insufficient methodology for e-commerce as it does not contain identification information about the site provider.

As phishing attacks and other threats become more common, consumers are more aware of how to inspect a site for legitimacy. Utilizing an EV or OV certificate will enhance a website’s reputation and give customers the assurance they need to do e-commerce transactions. EV is also a good choice for small businesses, as it can enhance their credibility by showing suspecting consumers that a prospective transaction is more legitimate and that the site is serious about protecting the data of its customers.

* * *


  1CAs also perform fraud checks to prevent domains similar to those that sound like popular sites from obtaining certificates (i.e. Paypalbank.com, Micr0sft.com)


 [1]: https://casecurity.org/2013/08/07/what-are-the-different-types-of-ssl-certificates/
 [2]: /uploads/2014/03/2014-04-18_0854.png