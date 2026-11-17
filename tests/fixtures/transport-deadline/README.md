# Transport deadline fixture ownership

`tests/unit/verify-blogthedata-transports.test.mjs` retains its native Vitest
filename and all original assertions, deadlines, fake CLI behavior, and cleanup.
Only its two deadline invocation bodies route through `supervised.ts`.
The production transport remains unchanged.

On Linux, `supervisor.py` is a test-owned ancestor outside the detached CLI
process group. It marks only itself as a child subreaper, executes the physical
TypeScript scenario with the current Node executable and inherited environment,
and waits for its scenario and every adopted child. The scenario calls the real
`vercelCurlTransport` and returns its success or error through a checked JSON
protocol. The supervising process must finish successfully before the original
PID assertions run. `waitpid` provides physical reaping; zombies are never
accepted as success.

The Python file is a narrow runtime requirement. Node exposes neither Linux's
`PR_SET_CHILD_SUBREAPER` nor `waitpid`. It uses only the Python standard library,
with no package installation, shell execution, host/PID 1 configuration changes,
network calls, process-name matching, or environment scanning. Its ctypes result
crosses into Python as `object` and is checked before use. The file is checked
with strict Python typing; no typing suppression or unchecked `Any` is authored.
The existing MJS transport implementation is validated as callable at the
TypeScript boundary, not claimed to be typechecked.

The tested transport budget stays 2,000 ms. The supervisor's outer 10-second
failure guard exceeds the existing fake CLI's 6-second self-bound; it cannot
turn a missed transport deadline into success. A separate 2-second reaping guard
matches the existing test's OS observation budget. A supervisor timeout, nonzero
scenario exit, interrupted run, or incomplete reaping makes the fixture fail.
Failure cleanup kills only kernel-reported direct children, repeats after
adoption, and waits for their exit. Non-Linux execution retains the original
direct production-helper call.

Root must review source before running the two targeted scenarios, then the full
transport test file under the test-network preload. A deadline regression or a
surviving descendant must remain a failing check. No runtime fixture execution
was performed during source preparation.
