---
authors:
- Tim Hollebeek
date: "2018-06-19T14:00:25+00:00"
dsq_thread_id:
- 6740978321
keywords:
- chrome
- s/mime
- code signing
- google
- microsoft
- encryption
- w3c
- mozilla
- hsm
- firefox
tags:
- Chrome
- S/MIME
- Code Signing
- Google
- Microsoft
- Encryption
- W3C
- Mozilla
- HSM
- Firefox
title: Fortify Allows Users to Generate X.509 Certificates in Their Browser


---
[Fortify][1], an open source application sponsored by Certificate Authorities through the CA Security Council, is now available for Windows and Mac. The Fortify app, which is free for all users, connects a user’s web browsers to smart cards, security tokens, and certificates on a user’s local machine. This can allow users to generate X.509 certificates in their browser, replacing the need for the deprecated `<keygen>` functionality.

## **Certificate Generation In The Browser**

The Web Cryptography API, also known as _Web Crypto_, provides a set of cryptographic capabilities for web browsers through a set of JavaScript APIs.

However, Web Crypto provides only _cryptographic primitives ­_– the general systems and methods that specific systems are built upon. For example, RSA is one of the primitives public key cryptosystems are built with.

This is great for the web as a platform – it gives developers easy access to cross-platform functionality. However, it also means that Web Crypto was not designed to incorporate some use cases deemed less important to the web as a whole.

Specifically, Web Crypto does not address compatibility with hardware security devices (i.e. smartcards) or certificate generation. This poses a problem to Certificate Authorities (CAs) and their customers, because browsers currently lack functionality for generating Code Signing and S/MIME certificates because _`<keygen>`_, part of the HTML specification, was deprecated without a replacement.

While the deprecation of `<keygen>` was necessary, due to security flaws, this created a gap in native functionality for browsers. The [Web Crypto spec acknowledges][2] that the API does not serve as a direct replacement of `<keygen>`:

“This API, while allowing applications to generate, retrieve, and manipulate keying material, does not specifically address the provisioning of keys in particular types of key storage, such as secure elements or smart cards.”

Now, `<keygen>` is still supported by some browsers, for example Firefox includes support, though Mozilla’s [developer website notes the feature is deprecated][3] and may be removed in the future. But Google Chrome deprecated `<keygen>` in version 49, [and removed it entirely in version 57][4]. Microsoft Edge [does not support the feature][5] nor plans to do so.

Without `<keygen>`, there is not a user-friendly way to locally generate certificates via the browser, which is needed for the enrollment of consumer Code Signing and S/MIME certificates. Fortify can fill this gap.

## **Fortify Extends Web Crypto API to include support for Certificates and Smart Cards**

Fortify is a flexible application which provides a link between the web browser (or other user agent) and certificates or smart cards on the user’s local machine. While it is not perfectly seamless, since it requires the user to install an additional application, it does fill the gap that `<keygen>`’s deprecation created, and it can provide much more functionality than that.

Fortify extends the Web Crypto API by directly addressing the key features the API was not designed to handle, mainly, allowing web applications to access smart cards, hardware security tokens (like the Yubikey 4 & NEO), and local certificate stores (for X.509 certificates).

Websites and web applications that support the Web Crypto API can easily start supporting Fortify to access these local devices and certificates.

Fortify provides a permission model that keeps users in control, allowing them to approve and manage which origins (sites) can utilize its powerful capabilities.

For CAs, Fortify can replace the need for `<keygen>` by allowing browser-based enrollment forms to connect to the user’s local certificate store for certificate and key generation.

Currently, CAs have no choice but to redirect users to another web browser if the user’s primary choice does not support `<keygen>`. In Firefox, users have to additionally be guided through an export procedure because the browser uses an independent keystore from the operating system. Once installed, Fortify provides an improved user experience over the typical browser implementations of `<keygen>`.

Because `<keygen>` does not natively integrate with PKCS#11 APIs, it also requires users to take the additional step of importing into keystores, which creates opportunities for poor key management.

Not only does `<keygen>` provide a subpar user experience, it also provides subpar security. Certificates are exported from the browser as .p12 files, which can be password protected, but frequently with weak encryption algorithms that are vulnerable to cracking. This leaves users with weak security controls on their private keys.

When generating a certificate using a hardware token or HSM, Fortify can guarantee that the key was created – and remains – on that device, by interfacing with it via its PKCS#11 library. Supporting the open source PKCS#11 standard is an interoperable and reliable way to support the large variety of hardware tokens in use today.

We view this as a significant improvement over `<keygen>`, which had an antiquated user experience due to its age and design goals. It’s also important to note that Fortify solves this problem in a way that is healthy for the web ecosystem. Fortify allows CAs to extend the functionality of Web Crypto past the W3C specification, providing a reliable way for the industry to meet its needs without requiring the inclusion of the functionality, which does not apply to most users, reducing un-necessary surface area in browsers.

Web applications which support Web Crypto can also use Fortify for enrollment of other types of X.509 certificates, as a way to sign/encrypt documents with client certificates, and user authentication.

Fortify is open source, compatible with Windows 7+ and OSX 10.12+, and works with all major browsers. For more information about how to use Fortify to generate certificates, contact your Certificate Authority.

 [1]: https://fortifyapp.com/
 [2]: https://w3c.github.io/webcrypto/Overview.html#scope-out-of-scope
 [3]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/keygen
 [4]: https://developers.google.com/web/updates/2017/02/chrome-57-deprecations
 [5]: https://developer.microsoft.com/en-us/microsoft-edge/platform/status/keygenelement/?filter=f3f0000bf&search=keygen