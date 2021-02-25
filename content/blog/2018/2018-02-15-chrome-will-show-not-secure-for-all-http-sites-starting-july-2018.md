---
authors:
- Bruce Morton
date: "2018-02-15T18:30:48+00:00"
dsq_thread_id:
- 6482214748
keywords:
- hsts
- android
- chrome
- https
- phishing
- google
- vulnerabilities
tags:
- HSTS
- Android
- Chrome
- SSL/TLS
- Phishing
- Google
- Vulnerability
title: Chrome Will Show Not Secure for all HTTP Sites Starting July 2018


---
Through 2017 and into 2018, we have seen the use of HTTPS grow substantially. Last Fall Google announced the following status:

  * Over 68% of Chrome traffic on both Android and Windows is now protected
  * Over 78% of Chrome traffic on both Chrome OS and Mac is now protected
  * 81 of the top 100 sites on the web use HTTPS by default

Google helped to drive this growth by implementing the “Secure” and “Not secure” status in Chrome’s status bar. “Secure” was provided for HTTPS sites. “Not secure” was implemented progressively, first resulting for HTTP pages requiring a password or credit card number. Then resulting for HTTP pages where text input was required.

In Chrome 68, which will be released in July 2018, we can expect [“Not secure” to be provided for all HTTP pages.][1]

{{< figure src="/uploads/2018/02/blog-image-20180215.png" >}} 

The new indicators will help encourage all website owners to deploy HTTPS on all pages that are supported by global browsers. In addition to showing the “Secure” indicator, HTTPS provides some of the following advantages to domain owners and browser users:

  * Security for all websites and pages regardless of content
  * Mitigate known HTTP vulnerabilities
  * Privacy for browser users
  * Support for HSTS, which will result in a browser error if the site is not secure
  * Support for HTTP/2 providing higher performance and less latency
  * Improved search rankings for Google
  * Increased user confidence, which can help bolster conversion rates

The downside is the “Secure” indicator will drive attackers to use HTTPS for fraudulent activities such as phishing. Hopefully, Google and other browser vendors are considering more reliable methods that steer their users away from phishing sites.

 [1]: https://security.googleblog.com/2018/02/a-secure-web-is-here-to-stay.html