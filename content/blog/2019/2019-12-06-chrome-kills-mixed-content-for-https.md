---
title: Chrome Kills Mixed Content for HTTPS
authors: [Bruce Morton]
date: 2019-12-06T16:52:24+00:00
tags: [SSL/TLS, Chrome]
---

In a phased approach, Chrome plans to block mixed content on secure websites to improve user security. [Most browsers already block some mixed content such as scripts and iframes by default.][1] Chrome is amping it up by gradually taking steps to also block images, audio recordings and videos, according to a recent [Google Security blog][2]. Preventing mixed content to load will eventually result in HTTPS websites losing their security indicator downgrading the site to HTTP, which alerts visitors that the site is not secure.

Mixed content happens when a website that is secured by HTTPS provides some content over HTTP. For example, the site might load scripts, iframes, images, audio or video over HTTP. Sometimes the insecure content is distributed from a third party. [Achieving HTTPS means securing all website content][3]. The issue with mixed content is that it is vulnerable to an attack. A bad actor could manipulate the insecure content to impart false information or possibly inject malicious code that could harm website users.

[Google has announced][2] how it plans to phase in the blocking of all mixed content for Chrome as follows:

  * **Chrome 79 (~10 December 2019):** will introduce a new setting that can be used to unblock mixed content on specific sites. Browser users can find this setting by clicking the `lock` icon on any `https://` page and clicking `Site Settings`. A new icon will replace the shield icon that had been used for unblocking mixed content in previous versions of desktop Chrome.

{{< figure src="/uploads/2019/12/chrome-kills-mixed-content-for-https-1.jpg" >}} 
    
  * **Chrome 80 (~4 January 2020):** Brings two key updates to mixed content: 
      * Mixed audio and video resources will be upgraded automatically to `https://` and downloaded if a secure version is available. Otherwise, Chrome will block the download by default. The new setting described above can be used to allow the content to load.
      * Mixed images will still be allowed to load, but will trigger a `Not Secure` indicator in the Chrome status bar. Developers can choose between `upgrade-insecure-requests` and `block-all-mixed-content` using the Content Security Policy to avoid this warning.

{{< figure src="/uploads/2019/12/chrome-kills-mixed-content-for-https-2.jpg" >}} 
            
  * **Chrome 81 (~17 March 2020):** Mixed images will automatically be upgraded to `https://`. Images that fail to load over to `https://` will be blocked by default.

In order to provide browser users with the best experience on your website and offer greater security, website owners are encouraged to secure all content including visual and multimedia and ensure that all content comes from secure sources.

 [1]: https://www.entrustdatacard.com/blog/2013/may/firefox-to-block-mixed-content
 [2]: https://security.googleblog.com/2019/10/no-more-mixed-messages-about-https_3.html
 [3]: https://www.entrustdatacard.com/blog/2018/may/the-tipping-point-for-https-is-closing-in