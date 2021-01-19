---
title: Firefox 23 Blocks Mixed Content
authors: [Wayne Thayer]
date: 2013-08-13T17:50:22+00:00
dsq_thread_id:
  - 1982737917


---
The latest version of the Firefox Web browser from Mozilla was released on August 6th with a great new security feature called a &ldquo;mixed content blocker&rdquo;. In a nutshell, this feature ensures that all of the parts of a secure Website are indeed encrypted via SSL certificates. All of the data on the website is prevented from being intercepted, and it becomes more difficult to add malware into the site&rsquo;s content.

Google published statistics a few years ago showing that the average number of external scripts and stylesheets on a page is roughly 10, and that number has likely increased since then. This means that you are typically trusting a number of other websites in addition to the one displayed in the navigation bar, even if you&rsquo;re visiting a website with an Extended Validation SSL certificate showing the organization&rsquo;s name in green. A simple example of this is the script for gathering statistics on the CA Security Council website &ndash; this script is loaded from stats.wordpress.com.

In the past, Firefox warned a user the first time they visited a site containing any kind of mixed content, then allowed the user to disable any further warnings. From then on, Firefox allowed external resources such as scripts to be loaded over HTTP without encryption, even if the main page was using HTTPS and displaying a lock icon denoting that the connection is encrypted. This is called &ldquo;mixed content&rdquo;, and with the new version of Firefox, it is broken into two categories. &ldquo;Active mixed content&rdquo; consists of scripts, stylesheets, and frames, and is blocked by default on every site because it has more potential to be a risk. Images and video are considered &ldquo;passive content&rdquo; and not blocked unless the user changes a setting.

This change brings Firefox in line with Google&rsquo;s Chrome browser which has a similar type of warning. Internet Explorer has warned users every time they visit a site with mixed content for many years.

The CA Security Council congratulates Mozilla on the release of Firefox 23 and the contribution it makes to a safer Internet. If you run a website using SSL, this is a good opportunity to test the site to ensure that all external content loads properly as described in our post on [SSL Optimization][1].

 [1]: https://casecurity.org/2013/07/29/getting-the-most-out-of-ssl-part-3-optimization/