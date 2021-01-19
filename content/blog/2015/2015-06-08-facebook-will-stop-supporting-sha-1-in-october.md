---
title: Facebook Will Stop Supporting SHA-1 in October
authors: [Ben Wilson]
date: 2015-06-08T16:14:36+00:00
dsq_thread_id:
  - 3831754275


---
On June 2, 2015, Facebook announced that it would stop supporting Facebook-connected apps that were signed with SHA-1, as of October 1, 2015.

> &ldquo;These changes are part of a broader shift in how browsers and web sites encrypt traffic to protect the contents of online communications. Typically, web browsers use a hash function to create a unique fingerprint for a chunk of data or a message. This fingerprint is then digitally signed to prove that a message has not been altered or tampered with when passing through the various servers and systems between your computer and Facebook&#8217;s servers.&rdquo; [[https://developers.facebook.com/blog/post/2015/06/02/SHA-2-Updates-Needed/](https://developers.facebook.com/blog/post/2015/06/02/SHA-2-Updates-Needed/)]

In its announcement, Facebook acknowledged that the [CA/Browser Forum&rsquo;s Baseline Requirements for SSL](https://cabforum.org/baseline-requirements-documents/) sunset SHA-1-based signatures as of January 1, 2016, but that it would be &ldquo;updating [its] servers to stop accepting SHA-1 based connections before this final date, on October 1, 2015. After that date, we&rsquo;ll require apps and sites that connect to Facebook to support the more secure SHA-2 connections.&rdquo;

Applications, SDKs, and devices that connect to Facebook will all need to support SHA-2, but those that still rely on SHA-1-based certificates will not work with Facebook. The CA Security Council has prepared a [whitepaper explaining some of the issues relevant to this transition][1].

 [1]: /uploads/2015/06/SHA-1-vs-SHA-2-Whitepaper-2015-06-08.pdf