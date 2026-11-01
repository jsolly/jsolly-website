# Independent Python script typing

Run `bash scripts/check-python-types.sh` from any directory. The script pins
mypy 2.4.1 and checks all five files listed in `mypy.ini`, including the existing
migration-backup tests, blog recovery regression and offline scanner fixtures,
with strict checking against Python 3.11.

This is partial repository coverage. The repository notebooks, including archived
instructional notebooks and public STAC examples, are outside this script check.
No notebook typing claim is made.

`docs/recipes-evidence/recompute-nutrition.py` is a frozen historical record,
excluded to preserve its exact recorded bytes under decision J17. See the
repository [invariants](../../AGENTS.md#invariants) and the
[recipe evidence contract](../../docs/recipes.md#evidence). The entire evidence
directory remains unchanged; the build and gate do not execute that script.

The repository hook implementation and its harness remain with the hooks fleet
owner; the legacy hook fixture also retains its frozen bytes. The executable
security scanner is part of the approved hook snapshot, so changes to it need
separate reviewed-bundle sequencing. These files remain unchecked here.

Normal gate integration is pending coordination with the website build/test
and hooks owners. Run this explicit check alongside the ordinary `npm run gate`;
the existing gate and CI do not yet invoke it automatically. No CI enforcement
or repository-wide strictness is claimed by this configuration.

The scanner test harness uses a precise protocol for its dynamically loaded,
repository-owned runner and typed lockfile/report fixtures. This checks the
harness, not the scanner implementation. The runner remains a member of the
verified hook snapshot and needs separate bundle ownership sequencing before
source changes. No hook snapshot, trust metadata, scanner command or CI policy
changes as part of this slice; pre-push remains gitleaks-only.
