# Recipe browsing performance

Collection pages start with six card summaries. Further summaries and images load
separately; full recipe data loads on an explicit open or individual print.
Background summary downloads do not add cards to the document.

## Budgets

| Measurement | Limit |
| --- | --- |
| Initial cards | 6 |
| Collection HTML, decoded | 200,000 bytes |
| Initial JavaScript, shared chunks and worker included, gzip | 100,000 bytes |
| Each summary response, gzip | 30,000 bytes |
| Cold startup, worker installation included, before summary trickling | 1,000,000 transferred bytes |
| Five-run mobile median Performance | At least 82 |
| Mobile blocking time | Below 200 ms |
| Accessibility, Best Practices and SEO | 100 |

Keep the initial count at six unless controlled scrolling tests show the next
batch arrives after the visible cards are exhausted. Measure at phone and desktop
widths before increasing it. The next batch starts within 300 px of the list end;
a keyboard-accessible Load more button remains available.

## Local candidate measurement, 2026-10-18

These measurements used the uncommitted implementation based on
`09d7c568cce7b1cf864853f66e0305d8662eae83`, built with Node 24.16.0.
The uncompressed run used worker `recipe-pages-pwa-575197b0b72da9a6d519`;
the gzip run used `recipe-pages-pwa-60ebda87ec29e148e371`. These are local
production builds, not deployed production releases. A subsequent history-only
guard repair does not change the rendering or loading strategy.

Lighthouse 13.5.0 ran five fresh mobile navigations to `/recipes/` in
HeadlessChrome 155.0.0.0. Mobile emulation used 412 × 823 CSS pixels and device
scale 1.75. Simulated throttling used 150 ms RTT, 1,638.4 Kbit/s throughput and
4× CPU slowdown. Storage reset was enabled. JavaScript and workers were enabled;
no competing browser test suite ran during measurement.

The test fixture's static server sends uncompressed assets. Its five-run median
was Performance **81**, blocking time **6 ms** and LCP **3.830 s**; it misses the
82 target. A separate same-origin gzip proxy compressed text responses without
changing their contents, matching ordinary compressed web delivery:

| Run | Performance | Blocking time | LCP |
| --- | --- | --- | --- |
| 1 | 100 | 7.5 ms | 1.524 s |
| 2 | 97 | 6.5 ms | 2.117 s |
| 3 | 96 | 6.5 ms | 2.266 s |
| 4 | 98 | 6.5 ms | 1.811 s |
| 5 | 98 | 9.5 ms | 1.986 s |
| Median | 98 | 6.5 ms | 1.986 s |

Accessibility, Best Practices and SEO were 100 in every run of both groups.
The earlier production baseline was Performance 67 and blocking time 459.5 ms.
The compressed local candidate clears the numeric targets, but this is not a
like-for-like deployed comparison. Repeat five runs on the exact deployed release
before claiming a verified production improvement.

After the final history cancellation and Forward settings fixes, a separate fresh,
worker-enabled 390 × 844 browser context measured startup with worker
`recipe-pages-pwa-33cd4ae6f758821bcee6`:

- Six mounted cards and 161,021 decoded HTML bytes.
- 99,623 gzip bytes across unique initial JavaScript resources, worker included.
- 762,526 estimated cold transferred bytes, including duplicate page and worker
  installation requests; subsequent summary requests were excluded.
- The largest of all 25 meal and smoothie summary pages was 1,597 gzip bytes.

The local static server does not compress responses. Transfer values above apply
gzip to text assets and use original binary sizes; they are estimates, not measured
Vercel wire bytes. Lighthouse navigation, startup transfer, background summary
traffic and worker installation are separate evidence streams.

The browser regressions cover pending-background scroll demand, stable shuffle
through search, native images, intent prefetch, Data Saver, loaded-card printing,
and opened-only saving. Offline update, restart and quota tests use isolated
release snapshots. Run the full repository gate from the repository root with
`npm run gate`; no individual benchmark replaces it.
