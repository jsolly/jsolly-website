"""Own and reap only this transport fixture's descendant processes on Linux.

Node has no subreaper or waitpid API. This stdlib Python fixture changes only its
own process's child-adoption flag, never PID 1 or host configuration. It remains
outside the detached CLI group killed by the production transport.
"""

from __future__ import annotations

import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
from types import FrameType

PR_SET_CHILD_SUBREAPER = 36
# The fake CLI already self-bounds at 6 seconds. This outer 10-second guard is
# failure containment, not the production transport's unchanged 2-second budget.
SCENARIO_TIMEOUT_SECONDS = 10
# Match the existing test's OS-reaping observation budget; never accept a zombie.
REAP_TIMEOUT_SECONDS = 2


class SupervisorInterrupted(Exception):
    def __init__(self, signum: int) -> None:
        super().__init__(f"Transport fixture supervisor interrupted by signal {signum}")
        self.signum = signum


def become_subreaper() -> None:
    if sys.platform != "linux":
        raise RuntimeError("The transport fixture subreaper requires Linux")
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong,
                      ctypes.c_ulong, ctypes.c_ulong]
    prctl.restype = ctypes.c_int
    result: object = prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
    if not isinstance(result, int) or result != 0:
        error = ctypes.get_errno()
        raise OSError(error, "Could not make the test-owned supervisor a subreaper")


def reap_deadline(_signum: int, _frame: FrameType | None) -> None:
    raise TimeoutError("Transport fixture descendants were not reaped within 2 seconds")


def owned_children() -> list[int]:
    # Kernel-reported direct children only. When an owned ancestor exits, its
    # remaining descendants are adopted here. No process-name or environment scan.
    own_pid = os.getpid()
    children = Path(f"/proc/{own_pid}/task/{own_pid}/children").read_text()
    return [int(value) for value in children.split()]


def reap_owned_children(root: subprocess.Popen[bytes], *, terminate: bool) -> None:
    previous = signal.signal(signal.SIGALRM, reap_deadline)
    signal.setitimer(signal.ITIMER_REAL, REAP_TIMEOUT_SECONDS)
    try:
        while True:
            if terminate:
                for pid in owned_children():
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        # A child can exit between the kernel inventory and kill.
                        pass
            try:
                pid, status = os.waitpid(-1, 0)
            except ChildProcessError:
                return
            if pid == root.pid:
                root.returncode = os.waitstatus_to_exitcode(status)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def main(command: list[str]) -> int:
    if not command:
        raise ValueError("Missing transport fixture scenario command")
    become_subreaper()
    root: subprocess.Popen[bytes] | None = None
    interrupted: list[int] = []

    def interrupt(signum: int, _frame: FrameType | None) -> None:
        # Record signals received during Popen too; never raise between child
        # creation and assigning its ownership handle.
        interrupted.append(signum)
        if root is not None:
            try:
                root.kill()
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    failures: list[Exception] = []
    exit_code = 1
    try:
        root = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                start_new_session=True)
        if interrupted:
            try:
                root.kill()
            except ProcessLookupError:
                pass
        exit_code = root.wait(timeout=SCENARIO_TIMEOUT_SECONDS)
        if exit_code != 0:
            failures.append(RuntimeError(f"Transport fixture scenario exited {exit_code}"))
    except subprocess.TimeoutExpired as error:
        failures.append(error)
    finally:
        # Further interrupts cannot skip ownership cleanup. This affects only
        # this standalone fixture process and ends with it.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if interrupted:
            failures.append(SupervisorInterrupted(interrupted[0]))
        if root is not None:
            try:
                reap_owned_children(root, terminate=bool(failures))
            except Exception as error:
                failures.append(error)
                try:
                    reap_owned_children(root, terminate=True)
                except Exception as cleanup_error:
                    failures.append(cleanup_error)
    if failures:
        for failure in failures:
            print(f"Transport fixture supervisor: {failure}", file=sys.stderr)
        return 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
