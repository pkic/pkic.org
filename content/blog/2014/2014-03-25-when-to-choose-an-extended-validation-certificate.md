---
authors:
- Wayne Thayer
date: "2014-03-25T17:30:45+00:00"
dsq_thread_id:
- 2499366759
keywords:
- ca/browser forum
- ssl
- extended validation
- ev certificate
tags:
- CA/Browser Forum
- SSL/TLS
- EV
title: When to Choose an Extended Validation Certificate


---
{{< figure src="/uploads/2014/03/eBusiness-Green-Bar-400x210-1.jpg" >}}In our last [post][1], we made a case for using Organizationally Validated (OV) or Extended Validation (EV) certificates for e-commerce, but we didn’t go into detail about the differences between OV and EV. EV certificates provide the highest level of assurance about your business, and they visually indicate this to your site’s visitors.

The telltale sign that a business has obtained an EV certificate for their website is commonly referred to as the “green bar” displayed in the browser. The exact form of the indicator varies in different desktop and mobile browsers, but is generally a green background, green font color, or green lock icon in the browser’s address bar. The name of the business entity identified by the certificate is often displayed within the green area. These indicators are meant to convey a high level of assurance to a site’s visitors about the reliability of the information in the certificate.

EV certificates are already in use by many of the top financial institutions and e-commerce sites, but many more sites can benefit from them. This is especially true if the site is used for transactions of any sort and attracts new customers that may need some reassurance about the legitimacy of the business to feel comfortable. While OV certificates provide a baseline level of assurance for e-commerce or transactional websites, EV is recommended.

EV certificates are backed by a detailed standard approved by the CA/Browser Forum back in 2007. To issue an EV certificate, a Certificate Authority (CA) must not only validate basic information about a business, the CA must collect information from multiple sources about the business and ensure that it all matches before issuing the certificate. This includes verification of the legal and physical existence of the business. This stringent validation process is the substance that backs up the flash of the EV indicator shown in browsers.

Despite all the benefits of EV certificates, there are a few situations where they might not be the best choice. As it currently stands, EV certificates are only available to registered entities and not to individuals. The CA/Browser Forum has repeatedly considered expanding EV to individuals, but they have found it difficult to distinctly identify an individual (e.g. ‘Robert Smith’) without implications for the individual’s privacy (e.g. including Robert Smith’s home address and government identification number in the certificate). In some countries including the US, it is also difficult to positively identify an individual.

A few other reasons to opt against using an EV certificate are:

  * Wildcards: if a [wildcard][2] certificate is desired, EV is not an option because the standard forbids it due to the increased potential for fraudulent websites to be operated without detection when using a wildcard certificate.
  * Time: the process to obtain an EV certificate can take some time to complete, so a company should check with their CA before choosing EV in a crunch.
  * Business locale: not all CAs are prepared to issue EV certificates to organizations in all countries.

Today’s business climate is more competitive than ever before. Website owners, namely those in ecommerce, are always looking for an advantage to bring more customers to their site and funnel them through the sales process. Distinguishing your site with an EV certificate sends a strong message to potential customers. If you are looking for the next competitive edge for your site and would like to drive higher customer conversions, then an Extended Validation SSL certificate is your best bet.

 [1]: https://casecurity.org/2014/03/12/think-twice-before-using-dv-for-e-commerce/
 [2]: https://casecurity.org/2014/02/26/pros-and-cons-of-single-domain-multi-domain-and-wildcard-certificates/