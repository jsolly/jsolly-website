---
slug: test-strategy-no-existing-tests
title: "A New Test Strategy: Introducing the Testing Pyramid to My Blog."
category: dev-tools
description: Learn my in-depth test strategy for Blogthedata using the test pyramid, including unit and UI testing with tools like Selenium and QASE for all features.
draft: false
image: /blog/media/migrated/image-e95e00c619b3ff1256a1dcf0-960.webp
legacyImage: post_metaimgs/idea_coming_out_of_box.png
imageAlt: A lightbulb coming out of a box
imageAttribution: ""
imageWidth: 960
imageHeight: 1192
published: "2022-03-26T01:45:46Z"
updated: "2024-11-06T13:38:01.419Z"
author: John Solly
feedAuthor: John_Solly
legacyAuthorId: 2
excerpt: <p>Learn my in-depth test strategy for Blogthedata using the test pyramid, including unit and UI testing with tools like Selenium and QASE for all features.</p>
legacyId: 30
related:
  - two-weird-reasons-I-love-unit-tests
  - integration-tests-are-a-scam-i-wrote-them-anyway
---

Blogthedata.com has no tests. There, I said it! But that changes today!

My test strategy begins with the testing pyramid

<img class="image_resized" src="/blog/media/migrated/image-79713719e8e51211ff715704-960.webp" alt="Testing Pyramid. The largest number of tests should be unit, then service, then UI." width="400" height="396">

The TDD Gods can look down on me for writing code without tests; I'll take it up with them in the afterlife. I will create unit tests FIRST for all code <strong>written from this day forward</strong>.

The plan is to have 100% unit test coverage. This is essential for when <a target="_blank" rel="noopener noreferrer" href="https://github.com/jsolly/awesome-django-blog/issues/20">blogthedata.com is&nbsp;'reactified'</a> because it will break a lot of stuff. I expect separating the front and backend of the application to be difficult!

The second step is to write service level (also known as integration tests). My understanding of service level tests is that they cover two or more functions working together.

The third phase incudes UI level (or E2E (End-to-End), acceptance tests). I can write these using tools such as Selenium (browser automation) as well as manual tests run by a human. I created a free account for a testing tool called QASE where I've written a few tests.

E2E tests focus on whether the coded features fit the business use case, and the functionality makes sense to a user.

<img class="image_resized" src="/blog/media/migrated/image-ec396f7616435a4d06a21712-960.webp" alt="Screenshot of QASE UI showing two tests for Posts " width="600" height="167">

Keep a watch on future PRs to verify I included tests!
