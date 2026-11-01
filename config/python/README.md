# Independent Python script typing

Run `bash scripts/check-python-types.sh` from any directory. The script pins
mypy 2.4.1 and checks all four files listed in `mypy.ini`, including the existing
migration-backup tests and blog recovery regression, with strict checking against Python 3.11.

This is partial repository coverage. The repository notebooks, including archived
instructional notebooks and public STAC examples, are outside this script check.
No notebook typing claim is made.

`docs/recipes-evidence/recompute-nutrition.py` is a frozen historical record,
excluded to preserve its exact recorded bytes under decision J17. See the
repository [invariants](../../AGENTS.md#invariants) and the
[recipe evidence contract](../../docs/recipes.md#evidence). The entire evidence
directory remains unchanged; the build and gate do not execute that script. The repository hook implementation,
frozen hook fixtures, security scanner and its tests are outside this slice
because their active owners are changing the trusted hook bundle. Their
exclusion here does not establish that they are strictly typed.

Normal gate integration is pending coordination with the website build/test
and hooks owners. Run this explicit check alongside the ordinary `npm run gate`;
the existing gate and CI do not yet invoke it automatically. No CI enforcement
or repository-wide strictness is claimed by this configuration.
