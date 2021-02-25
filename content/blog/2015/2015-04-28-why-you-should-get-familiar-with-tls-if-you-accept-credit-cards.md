---
authors:
- Billy VanCannon
date: "2015-04-28T16:27:35+00:00"
dsq_thread_id:
- 3720076616
keywords:
- https
- vulnerability
- encryption
- pdf
- tls
- vulnerabilities
- ssl
tags:
- SSL/TLS
- Vulnerability
- Encryption
- PDF
title: Why You Should Get Familiar With TLS If You Accept Credit Cards


---
The group that manages the Payment Card Industry Data Security Standard [quietly announced](http://training.pcisecuritystandards.org/pci-ssc-bulletin-on-impending-revisions-to-pci-dss-pa-dss-assessor) in February that an imminent update was coming to its payment card and application requirements related to the use of the SSL encryption protocol. Since then, there has been growing concern among merchants about what the changes mean to them.

The confusion among retailers generally can be boiled down to two questions:

  1. What will the new updates require me to do?
  2. What happens to my TSL/SSL certificates?

First let’s explain what’s going on: On Feb. 13, the PCI Security Standards Council [informed](http://training.pcisecuritystandards.org/pci-ssc-bulletin-on-impending-revisions-to-pci-dss-pa-dss-assessor) its assessor community that SSL (Secure Sockets Layer) – a protocol designed to ensure that data provided between a web server and a web browser, such as credit card information, remains secure – [is no longer an acceptable way][1] to provide "strong cryptography." This is due to a number of known fundamental vulnerabilities – some of which, such as Heartbleed, we have documented [here][2], [here](https://www.trustwave.com/Resources/trustwave-blog/Bark-and-Bite--The-Essential-Facts-on-the-POODLE-Vulnerability/) and [here](https://www.trustwave.com/Resources/trustwave-blog/Don-t-FREAK--A-Q-A-on-the-Latest-Big-Vulnerability/) – that essentially make SSL, as an encryption mechanism, obsolete.

In March, the council made the news official by offering [additional information (PDF)](https://www.pcisecuritystandards.org/pdfs/15_03_25_PCI_SSC_FAQ_SSL_Protocol_Vulnerability_Revisions_to_PCI_DSS_PAD.pdf) in the form of an FAQ, including encouraging merchants to upgrade to SSL’s successor, a much-stronger protocol known as Transport Layer Security (TLS). Think of TLS – the current version is 1.2 – as a [more evolved version of SSL](http://www.tomsguide.com/us/ssl-vs-tls,news-17508.html). With the migration, retailers are getting rid of the old stuff that doesn’t work very well anymore.

The PCI council also stated that later this month it will publish an update (version 3.1) to the PCI DSS. An update to the Payment Application DSS (PA-DSS) is scheduled to follow. Merchants will be given a certain amount of time to implement the changes.

While the council doesn’t plan to immediately crack the whip on retailers, many of whom are still [getting comfortable with the 3.0](https://www.trustwave.com/Resources/trustwave-blog/Panicking-Over-PCI-DSS-3-0--Catch-Up-on-the-Big-Changes--Video-/) versions of both payment standards, businesses should become familiar with their new payment security responsibilities.

So let’s go back to the earlier questions:

## What will the new updates require me to do?

For merchants, such as e-commerce companies, accepting payments in card-not-present environments, they must disable SSL and configure their web servers to use the most recent version of TLS. If they outsource the management and maintenance of their commerce environment to a hosting provider, then they must ensure that the vendor will do this for them. Card-present merchants, on the other hand, must consult with their point-of-sale and payment application vendors to ensure the payment-acceptance software they are using is not communicating with the SSL protocol.

## What happens to my TLS/SSL certificates?

Nothing, unless you have reason to believe that you were compromised with one of the recent SSL exploits. Your certificates are, essentially, files that store cryptographic key information and identification information for whom the certificate was issued. The SSL or TLS protocol is just part of the way the server defines the ‘rules’ for how that encryption is implemented into the conversation between the client and server.

Retailers of all types should stay on top of this developing situation, considering what we know about [the dangers of SSL](https://www.trustwave.com/Resources/trustwave-blog/Why-the-Heartbleed-Bug-Won-t-Go-Away/) as an encryption protocol, as well as the fact that a business may be able to outsource certain commerce responsibilities to a third-party, but not its liability associated with a data breach.

So, those are the basics of what you need to know. If you have any additional questions or concerns, please leave them in the comments.

_Note: This blog post was adapted from an original piece by Dan Kaplan on the_ [_SecureTrust blog_][3]_._

 [1]: https://www.owasp.org/index.php/Transport_Layer_Protection_Cheat_Sheet#Rule_-_Only_Support_Strong_Protocols "is no longer an acceptable way"
 [2]: https://www.trustwave.com/Resources/trustwave-blog/FAQs--The-Heartbleed-Bug/
 [3]: https://www.trustwave.com/Resources/trustwave-blog/Why-You-Should-Get-Familiar-with-TLS-if-You-Accept-Credit-Cards/?page=1&year=0&month=0&topic=0&category=0&author=0