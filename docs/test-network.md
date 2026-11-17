# Test network isolation

Unit, built, CSP, workflow and smoke contract suites may use loopback TCP and
local IPC. They cannot connect to external services. This contract also applies
to custom labels used by runner fixtures. Production acceptance deliberately
checks the live site and remains separate.

The native suite runner supplies a Node preload before importing test code.
Vitest global setup owns a SOCKS proxy and supplies its endpoint to workers;
worker setup installs the same Node guard before collecting tests. Fresh child
environments explicitly use `withOfflineNodeGuard` without inheriting host
credentials. The guard rejects nonloopback destinations before socket connection
or hostname lookup. Recorded violations fail teardown and process exit even when
application code catches the connection error.

The runner sets `ASTRO_TELEMETRY_DISABLED=1` for offline suites and their nested
builds. This prevents Astro's optional telemetry from attempting an external
connection. Live production acceptance keeps its existing environment.

Browser clients import the factories from `tests/network/browser.ts`. Each
factory requires the fixture proxy and disables Chromium's implicit loopback
proxy bypass. The SOCKS listener validates literal loopback destinations before
opening an upstream connection. `localhost` resolves to a loopback literal
without DNS. The same proxy handles worker and service-worker requests,
redirects, WebSockets and context requests without changing HTTP caching or
service-worker behavior. Keep off-origin response stubs in the existing tests.
Do not override a browser context's proxy or launch Chromium outside these
factories in an offline suite.

This is a test harness for trusted repository code, rather than an operating
system sandbox for hostile native programs. It requires no namespace, firewall,
or host security changes. QUIC and nonproxied WebRTC UDP are disabled; the
repository tests do not use raw DNS, UDP or native external transports.

New implementation modules and executable fixtures are strict TypeScript.
[Existing native clients](../config/typescript/network-native-clients.md) keep
their discovery filenames while receiving only factory and setup routing.

`npm test` includes isolated native Node controls for TCP, HTTP, HTTPS, TLS,
redirects, local IPC, fresh environments, worker threads and forks. They require
exact guard-denial and completed-cleanup receipts, so an unrelated child failure
cannot count as a successful block. Certificate controls generate and remove a
local temporary certificate with OpenSSL.

`npm run test:built` includes paired browser controls. Each positive reaches a
second loopback server; the corresponding negative restricts its port and must
produce a proxy denial with no request received. A private mutation allows only
that loopback port and must invalidate the negative predicate. No control needs
to send a request to an external service. The frame control covers an ordinary
iframe; it does not establish a separate OOPIF attachment.
