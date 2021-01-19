---
title: The Web Is Moving From HTTP to HTTPS
authors: [Dean Coclin]
date: 2016-11-21T17:56:09+00:00
dsq_thread_id:
  - 5321741303
tags:
 - SSL/TLS

---
The four letters, “http”, are known to technical and non-technical users alike as the beginning of any web address. These have been ubiquitous for many years. But things are about to change. Pretty soon, you won’t be able to go to many popular websites just by using those 4 letters. You will need to add an “s” at the end (https). Why is this happening? What are the reasons for this change?

https indicates that a web page uses the security protocol known as TLS (previously known and more commonly referred to as SSL). This shows that encryption is in place between the server and the user’s browser.

There are several changes being put into place by web browsers and others which we summarize here:

1. Web browsers will warn users of non-https connections. Chrome plans to highlight insecure pages with red X in the address bar. They will also warn if an insecure page asks for a password or credit card by showing the words “Not Secure”. Firefox plans a similar warning for sites requesting passwords. In the future, both will transition from an information warning to a red triangle which is more noticeable.
2. Several powerful features in Chrome will only be available over https. Services like Geolocation, Device Motion/Orientation, Full screen mode, DRM and more are strictly limited to https connections. Websites that need these features will have to implement SSL/TLS to utilize them.
3. The replacement and much faster protocol for http is known as http2. This is supported by Chrome, Firefox, Internet Explorer, Safari and Opera ONLY over https. As websites migrate to the speedier http2, they must use SSL/TLS.
4. Websites seeking referrer data from other sites must use https. This is important for sites that receive referrals from other sites. Without https, the destination sites won’t know who is coming to their site.
5. Gmail is now showing its users whenever an insecure connection is used by depicting an open lock in the gmail user interface. Email servers that use certificates to encrypt mail server to mail server data don’t show an open lock and detail the type of encryption used.
6. Many sites have completed the move to https everywhere including Google’s Blogspot and Analytics, Reddit, Flickr, Wikimedia, WordPress, Bitly and Shopify. The U.S. Government has mandated that all sites under the .gov domain must be https by the end of 2016.

Reason #1 alone is enough to make most sites to move to https. No serious site will want to have a red X in the address bar displayed to its users. Be prepared by securing your site with the proper certificate. Read our previous [blog][1] on the different types of SSL certificates and how to [choose][2] the right one for your site.

 [1]: https://casecurity.org/2013/08/07/what-are-the-different-types-of-ssl-certificates/
 [2]: https://casecurity.org/2013/05/24/getting-the-most-out-of-ssl-part-1-choose-the-right-certificate/