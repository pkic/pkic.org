---
authors:
- Bruce Morton
date: "2016-09-15T18:59:31+00:00"
dsq_thread_id:
- 5147064909
keywords:
- chrome
- ssl
- https
- google
- tls
- vulnerabilities
- hsts
tags:
- Chrome
- SSL/TLS
- Google
- Vulnerability
- HSTS
title: Chrome to Show HTTP Sites as Not Secure


---
## _Always-On SSL should be deployed to prevent the “Not secure” warning_

Website owners who do not secure their website with an SSL/TLS certificate will have to rethink their online strategy.  In a push to make the Internet safer for all users, Google will soon be issuing a stronger warning to visitors who navigate to a website that does not have the protection of an SSL/TLS certificate.

With the release of Chrome 53 on Windows, Google has [changed the trust indications][1] to introduce the circle-i. Subsequently, Google has announced a [new warning message][2] will be issued when a website is not using HTTPS.

In January 2017, with the release of Chrome 56, a “Not secure” message will be presented on pages with **password and credit card form fields** that are not protected with an SSL/TLS certificate.

{{< figure src="/uploads/2016/09/chrome-http-not-secure-image003.png" >}} 

This should really help answer the question, “Is this site secure?” Or, maybe a better question “Is this site encrypted?” The answer is, “No, the site is **not encrypted**, so not secure.”

Google does not plan to stop there. In a to-be-announced release, Chrome will not show the circle-i, but will show the red triangle for **all HTTP pages**. This is the same indication that is provided for broken HTTPS sites and will further stress the “not secure” message.

{{< figure src="/uploads/2016/09/chrome-http-not-secure-image002.png" >}} 

Website owners and administrators need to consider Always-On SSL or the HTTPS Everywhere concept. Now HTTPS will provide the following advantages:

  * Security to all websites and pages regardless of content
  * Mitigate known vulnerabilities such as SSLstrip and Firesheep
  * Provide browser user privacy
  * Support HSTS that will provide a browser error if the site is not secure
  * Support HTTP/2 providing higher performance and less latency
  * Higher search engine optimization (SEO) for Google
  * Higher trust indication with a green lock icon and no “Not secure”

With proper installation of an SSL/TLS certificate, the “not secure” warning will disappear and be replaced by a green lock icon. Then the answer to the above questions will be “Yes, the site is secure.”

 [1]: https://casecurity.org/2016/08/24/trust-indication-change-in-google-chrome/
 [2]: https://security.googleblog.com/2016/09/moving-towards-more-secure-web.html