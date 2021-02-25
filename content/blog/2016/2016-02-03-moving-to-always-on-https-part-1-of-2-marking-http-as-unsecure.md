---
authors:
- Ben Wilson
date: "2016-02-03T21:32:31+00:00"
dsq_thread_id:
- 4549273563
keywords:
- tls
- vulnerabilities
- hsts
- mozilla
- malware
- firefox
- mixed content
- chrome
- ssl
- https
- google
tags:
- SSL/TLS
- Vulnerability
- HSTS
- Mozilla
- Malware
- Firefox
- Mixed Content
- Chrome
- Google
title: Moving to Always on HTTPS, Part 1 of 2; Marking HTTP as Unsecure


---
Over the past several years there has been increased discussion about deprecating HTTP and making HTTPS the default protocol for the World Wide Web.  (HTTP stands for “HyperText Transfer Protocol” and the “S” in HTTPS is enabled with an SSL/TLS digital certificate properly installed and configured on a web server.)  These discussions have taken place in the context of browser security indications and technical improvements simplifying the global movement to “Always on HTTPS.”   Part 1 of this two-part blog post will address browser security indicators, while Part 2 discusses technical developments to make HTTPS the default protocol when browsing the web.

A recent article, “Google will soon shame all websites that are unencrypted” (<http://motherboard.vice.com/read/google-will-soon-shame-all-websites-that-are-unencrypted-chrome-https>), has generated some new discussion on the topic of browser security indicators.  The article suggested that in the future Google Chrome might display a red “X” over the padlock icon for unencrypted communications using HTTP.  While it is unclear whether this will happen (it is likely to be a softer signal than a red “X”), it is certain that Google intends to phase in non-secure indicators for non-secure origins and unencrypted communications.  See 

<https://www.chromium.org/Home/chromium-security/marking-http-as-non-secure>.  Google already incentivizes moving to HTTPS by increasing the search ranking for pages sent over HTTPS. <https://googleonlinesecurity.blogspot.in/2014/08/https-as-ranking-signal_6.html>. Moreover, it is clear that Google is pushing for a change to the status quo when it comes to displaying ordinary HTTP content.  “We know that people do not generally perceive the absence of a warning sign … Yet the only situation in which web browsers are guaranteed not to warn users is precisely when there is no chance of security: when the origin is transported via HTTP. Here are screenshots of the status quo for non-secure domains …” (screenshots omitted).  Regardless of how the “unsecure” warning will appear, suffice it to say, the status quo has got to go. In the future we may see a noticeable difference when we visit a site without any HTTPS. 

Meanwhile, here is how Google Chrome currently displays HTTP – <https://googleonlinesecurity.blogspot.com/2015/10/simplifying-page-security-icon-in-chrome.html>, and here are Mozilla Firefox’s security indicators – <https://blog.mozilla.org/tanvi/2016/01/26/updated-firefox-security-indicators/>  These two examples from Google and Mozilla don’t show any special “HTTP only” indicator presently, but they do show how mixed content (part HTTP and part HTTPS) can trigger alerts in all browsers.  They illustrate the importance of Always on HTTPS, because without 100% HTTPS, a door is left open for a hacker to potentially exploit.  Mixed content often arises with embedded scripts, stylesheets, images, videos, and other media.  See <https://developer.mozilla.org/en-US/docs/Security/MixedContent>   Such mixed content can “intercept the request for the HTTP content. The attacker can also rewrite the response to include malicious JavaScript code. Malicious active content can steal the user’s credentials, acquire sensitive data about the user, or attempt to install malware on the user’s system (by leveraging vulnerabilities in the browser or its plugins, for example).”   Preventing mixed content is part of the Always on HTTPS approach advocated by the CA Security Council, and it will help you avoid browser warnings.  

Here are some more tips to keep websites secure with Always on HTTPS:

  1. Obtain the right kind of SSL/TLS Certificate(s) needed to secure all of your web properties
  2. Force any attempted “HTTP” connections to “HTTPS” with redirects from port 80 to  port 443.
  3. Replace all URLs in your code with HTTPS resources (and require all of your third party content providers to make their information accessible over HTTPS)
  4. Add HTTP Strict Transport Security (HSTS) headers to your web pages.  (HSTS is a directive that forces web browsers to communicate with your site only using https)

Next — Part 2 of this blog post will go into greater detail about HSTS and other technical measures currently available or being considered to ensure global implementation of Always on HTTPS.