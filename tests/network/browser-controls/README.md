# Browser boundary regression controls

`harness.ts` exports `runBrowserControls()`. It performs pure protocol/policy
checks, then returns 31 structured receipts after the paired browser controls and
resource cleanup succeed. A failed operation or cleanup rejects. Imports and
fixture lookup are relative to this component; importing it starts no controls.
The process-level proxy environment requires serial invocation. A second
concurrent call rejects before changing that environment; sequential calls own
fresh state and restore the prior endpoint.

Run through the built-suite wrapper with the repository's Node network preload.
The caller owns the suite timeout and discovery/count manifest. No application
test assertion or deadline is changed here. The harness uses 15-second operation
bounds; third-party shutdown is also bounded by the owning suite's timeout.

The thirteen paired channels are navigation, ordinary iframe, redirects,
dedicated/shared workers, service-worker install/import/update/fetch, WS/WSS,
context.request and route.fetch. Positive cases permit loopback A and B ports;
negative cases permit only A. Each positive requires a successful operation and
B receipt. Each negative requires a failed operation, zero B receipts and proxy
port-denial evidence. The literal loopback host floor remains enabled throughout.
Raw SOCKS controls cover fragmented greeting/request and early payload forwarding.
Persistent-profile restart, launchServer, and missing/malformed endpoint checks
exercise the supported launch factories.

The mutation control permits B's port, then proves an inverted-negative receipt
(allowed=false, success=true, B requests>0, zero denials) outside the expected
assertion catcher. Only the original negative success predicate is expected to
fail. This cannot accept a positive-setup failure as mutation detection.

Every executable worker/service-worker/import fixture is physical strict
TypeScript under `fixtures/`, compiled using the installed esbuild at runtime.
All five configs inherit the repository TypeScript config, including its full
strict diagnostic flags. Separate worker configs use the defining WebWorker interfaces without
mixing DOM and worker globals. `tsconfig.json` checks Node/controller/browser
operations; each `tsconfig.<fixture>.json` checks its actual worker environment.
Root integration owns wiring these configs into the repository's type gate.

The three documented lint directives apply to this native assertion harness:
serial shared sentinel/lifecycle checks and Node assertions outside a Vitest
wrapper. They disable no control or application assertion.

Coverage gap: the iframe case does not establish an out-of-process iframe CDP
attachment. No OOPIF claim is made. Returned public browser objects must not be
used with per-context proxy overrides. The harness has none; caller coverage is
a separate invariant. These controls do not claim an OS or hostile-code sandbox.
