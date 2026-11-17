# Recipe image failure diagnostics

This project strictly checks all six migrated progressive-recovery scenarios and
their passive diagnostics. It extends the repository's test-network project and
retains its strict compiler flags. Only this project enables real-source
JavaScript inference with `allowJs: true` and `checkJs: false`. The unchanged
`tests/built/pages.mjs`, `tests/built/recipe-artifact-gate.mjs`, and their imported
JavaScript owners remain unmigrated and are not claimed to be fully typed.
Those imports can infer `any`; there are no ambient declarations, facades,
re-exports, unchecked casts, or new JavaScript implementations. Recipe JSON is
parsed from `unknown` with the used fields validated. New browser and diagnostic
interactions use the installed Playwright types.

The held `35faa408` typed test was compared and not reused wholesale. It changes
background connection settings and artifact-completion behavior. This migration
retains the current six cases, assertions, false-then-true JavaScript loop,
actions, artifact waits, context options, and explicit 30,000/40,000 ms deadlines.
Missing required DOM nodes still fail; TypeScript guards make that assumption
explicit. The image predicate still checks the first image's positive natural
width. Extracting grid text preserves the existing string assertion.

The image case records synchronous phases around its existing awaits and uses
synchronous request, response, failure, and lifecycle listeners. It adds no
asynchronous browser operation, snapshot, route, init script, retry, handshake,
wait, timeout, or cleanup owner. Its original `try/finally` and awaited
`context.close()` remain in place for each loop iteration. Every diagnostic
method and listener is nonthrowing, including marks immediately before cleanup.

Installed Vitest records the result before `onTestFinished`, then runs
`onTestFailed`. The diagnostic completion hook reads the actual typed task result
and synchronously reports the retained trace only after failure is recorded.
It then removes its own listeners. This cannot delay the original error or
replace it with a framework timeout. No context or browser is closed by this
hook; the existing test and suite retain their original resource ownership.

The trace retains at most 128 events and 64 pending requests. Retained string
fields are limited to 512 UTF-16 units, with clipping counters. Each output
packet, including prefix and newline, is bounded to 65,536 UTF-8 bytes. Oversized
packets become valid JSON preview envelopes with omission counters. Phase marks
remain visible even if a framework timeout interrupts the body. The last phase
and HTTP/lifecycle receipts distinguish navigation, scrolling, natural-width
waiting, and teardown before deciding whether further DOM instrumentation is
needed.

No browser or test execution was performed during preparation. Run all six cases
through the existing loopback boundary after source review. Do not select only
the failing case, change a deadline, or alter the counted suite ledger.
