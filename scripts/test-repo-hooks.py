#!/usr/bin/env python3
"""Exercise this repository's hook trust with real Git and an isolated home."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import pytest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parent.parent
BUNDLE = ('config/agents/repository.json', 'gate/gate-lib.sh', 'gate/hooks/pre-commit',
          'gate/repo-hooks.py', 'gate/repo-python.sh', 'gate/setup-agent-environment.sh',
          'gate/security-scan.py')

ZERO = '0' * 40
# Stands in for gitleaks: logs each call's arguments and the subjects of the commits its
# --log-opts select, fails on spacing gitleaks would pass to git as an empty revision or when git
# cannot read that range, and finds a leak in any commit whose subject is "leak".
FAKE_GITLEAKS = '''#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = version ]; then echo 8.24.2; exit 0; fi
printf '%s\\n' "$*" >> "$FIXTURE_CALLS"
for arg; do case $arg in --log-opts=*) opts="${arg#--log-opts=}";; esac; done
# gitleaks splits --log-opts on single spaces, so an extra space reaches git as an empty revision.
case $opts in " "*|*" "|*"  "*) echo "fixture: malformed --log-opts" >&2; exit 3;; esac
subjects="$(git log --format=%s $opts)"
[ -z "$subjects" ] || printf '%s\\n' "$subjects" >> "$FIXTURE_SCANNED"
! grep -qx leak <<<"$subjects"
'''


def load_module(path):
    """Import a hook helper (current candidate or frozen fixture) from its file."""
    spec = importlib.util.spec_from_file_location(Path(path).stem.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestHookTrust:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path):
        self.scratch = tmp_path.resolve()
        self.root = self.scratch / 'repo'
        self.home = self.scratch / 'home'
        self.root.mkdir()
        self.home.mkdir()
        config = self.home / 'fixture.gitconfig'
        config.write_text('[maintenance]\n    auto = false\n')
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('GIT_', 'PYTHON'))}
        self.env.update(HOME=str(self.home), GIT_CONFIG_GLOBAL=str(config), GIT_CONFIG_NOSYSTEM='1',
                        GIT_AUTHOR_NAME='fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                        GIT_COMMITTER_NAME='fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid')
        self.git('init', '-q', '-b', 'main')
        for name in BUNDLE:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(SOURCE / name, target)
        slug = json.loads((self.root / 'config/agents/repository.json').read_text())['repo']
        self.git('remote', 'add', 'origin', 'https://github.com/' + slug + '.git')
        (self.root / '.git-hooks').mkdir()
        floor = (SOURCE / '.git-hooks/pre-commit').read_text().splitlines()[1]
        hook = self.root / '.git-hooks/pre-commit'
        hook.write_text('#!/usr/bin/env bash\n' + floor + '''
set -euo pipefail
owner="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$owner/gate/gate-lib.sh"
gate_enter_committing_tree "${BASH_SOURCE[0]}"
printf 'fixture-root=%s\\n' "$ROOT"
gate_gitleaks_bin() { printf '%s\\n' "$ROOT/tools/fixture-gitleaks"; }
gate_secrets_scan_staged
''')
        hook.chmod(0o755)
        (self.root / 'gate/security-scan.py').write_text(
            'import sys\nprint(\"fixture-security-phase=\" + sys.argv[1])\n')
        tools = self.root / 'tools'
        tools.mkdir()
        scanner = tools / 'fixture-gitleaks'
        scanner.write_text('''#!/usr/bin/env bash
if git diff --cached --text | grep -q REPO_FIXTURE_SECRET; then
  echo fixture-secret-found >&2
  exit 1
fi
''')
        scanner.chmod(0o755)
        (self.root / 'content.txt').write_text('safe baseline\n')
        self.git('add', '-A')
        self.git('commit', '-qm', 'fixture baseline')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.tool('install', check=True)
        self.hooks = Path(self.git('config', '--get', 'core.hooksPath').stdout.strip())
        self.installed = self.hooks.parent / 'gate/repo-hooks.py'

    def git(self, *args, root=None, check=True):
        return subprocess.run(['git', '-C', str(root or self.root), *args], env=self.env,
                              text=True, capture_output=True, check=check)

    def tool(self, command, *args, installed=False, script='gate/repo-hooks.py', check=False):
        path = self.installed if installed else self.root / script
        return subprocess.run([sys.executable, '-I', str(path), command, '--root', str(self.root), *args],
                              cwd=self.root, env=self.env, text=True, capture_output=True, check=check)

    def dispatch(self, root=None):
        return subprocess.run([str(self.hooks / 'pre-commit')], cwd=root or self.root,
                              env=self.env, text=True, capture_output=True)

    def test_fresh_home_and_linked_worktree_run_the_committing_tree(self):
        assert not ((self.home / 'code/dotagents').exists())
        result = self.dispatch()
        assert result.returncode == 0, result.stderr
        assert 'fixture-root=' + str(self.root) in result.stdout
        linked = self.scratch / 'linked'
        self.git('worktree', 'add', '-qb', 'linked', str(linked))
        result = self.dispatch(linked)
        assert result.returncode == 0, result.stderr
        assert 'fixture-root=' + str(linked) in result.stdout

    def test_unreviewed_library_is_not_executed_or_installed(self):
        lib = self.root / 'gate/gate-lib.sh'
        marker = self.scratch / 'untrusted-executed'
        lib.write_text('touch "' + str(marker) + '"\n' + lib.read_text())
        before = self.git('config', '--get', 'core.hooksPath').stdout
        assert self.dispatch().returncode != 0
        assert self.tool('install', installed=True).returncode != 0
        assert not (marker.exists())
        assert before == self.git('config', '--get', 'core.hooksPath').stdout

    def commit(self, subject):
        tree = self.git('rev-parse', 'HEAD^{tree}').stdout.strip()
        return self.git('commit-tree', tree, '-p', 'HEAD', '-m', subject).stdout.strip()

    def pre_push(self, records, remote='origin'):
        tools = self.scratch / 'path-tools'
        if not tools.exists():
            tools.mkdir()
            (tools / 'gitleaks').write_text(FAKE_GITLEAKS)
            (tools / 'gitleaks').chmod(0o755)
        logs = {name: self.scratch / name for name in ('calls', 'scanned')}
        for log in logs.values():
            log.unlink(missing_ok=True)
        env = {**self.env, 'PATH': str(tools) + os.pathsep + self.env['PATH'],
               'FIXTURE_CALLS': str(logs['calls']), 'FIXTURE_SCANNED': str(logs['scanned'])}
        result = subprocess.run([str(self.hooks / 'pre-push'), remote, 'fixture-url'], cwd=self.root,
                                env=env, input=records, text=True, capture_output=True)
        read = {name: log.read_text().splitlines() if log.exists() else [] for name, log in logs.items()}
        return result, read['scanned'], read['calls']

    def test_pre_push_scans_the_commits_the_destination_lacks(self):
        outgoing = self.commit('outgoing')
        # Another remote holding the commit does not mean origin has it.
        self.git('update-ref', 'refs/remotes/other/held', outgoing)
        result, scanned, calls = self.pre_push(f'refs/heads/topic {outgoing} refs/heads/topic {ZERO}\n'
                                               f'(delete) {ZERO} refs/heads/gone {outgoing}\n')
        assert result.returncode == 0, result.stderr
        assert scanned == ['outgoing']
        assert len(calls) == 1 and '--redact' in calls[0].split()
        # The same options as `security-scan.py ci` and gate/ci-secrets-scan.sh.
        assert '--log-opts=--text --diff-merges=remerge --no-color --no-textconv ' in calls[0]

    def test_pre_push_to_a_url_excludes_only_the_remote_commit_it_replaces(self):
        outgoing = self.commit('outgoing')
        baseline = self.git('rev-parse', 'HEAD').stdout.strip()
        url = 'https://example.invalid/fixture.git'
        result, scanned, _ = self.pre_push(f'refs/heads/main {outgoing} refs/heads/main {baseline}\n', remote=url)
        assert result.returncode == 0, result.stderr
        assert scanned == ['outgoing']
        # A new ref at a URL has nothing to exclude, so the commit's whole history is scanned.
        result, scanned, _ = self.pre_push(f'refs/heads/topic {outgoing} refs/heads/topic {ZERO}\n', remote=url)
        assert result.returncode == 0, result.stderr
        assert scanned == ['outgoing', 'fixture baseline']

    def test_pre_push_blocks_a_leak_in_any_outgoing_ref(self):
        clean, leak = self.commit('outgoing'), self.commit('leak')
        result, scanned, _ = self.pre_push(f'refs/heads/clean {clean} refs/heads/clean {ZERO}\n'
                                           f'refs/heads/leak {leak} refs/heads/leak {ZERO}\n')
        assert result.returncode != 0
        assert scanned == ['outgoing', 'leak']

    def test_pre_push_scans_sent_objects_and_refuses_non_commits(self):
        leak = self.commit('leak')
        self.git('replace', leak, self.commit('decoy'))
        result, scanned, _ = self.pre_push(f'refs/heads/topic {leak} refs/heads/topic {ZERO}\n')
        assert result.returncode != 0
        assert scanned == ['leak']
        tree = self.git('rev-parse', 'HEAD^{tree}').stdout.strip()
        result, _, calls = self.pre_push(f'refs/tags/tree {tree} refs/tags/tree {ZERO}\n')
        assert result.returncode != 0
        assert calls == []

    def test_pre_push_runs_only_installed_snapshot_bytes(self):
        marker = self.scratch / 'working-tree-library-ran'
        (self.root / 'gate/gate-lib.sh').write_text('touch "' + str(marker) + '"\n')
        outgoing = self.commit('outgoing')
        result, scanned, _ = self.pre_push(f'refs/heads/topic {outgoing} refs/heads/topic {ZERO}\n')
        assert result.returncode == 0, result.stderr
        assert scanned == ['outgoing']
        assert not marker.exists()

    def test_unreviewed_scanner_is_not_executed(self):
        marker = self.scratch / 'unreviewed-scanner-ran'
        (self.root / 'gate/security-scan.py').write_text(
            'from pathlib import Path\nPath(' + repr(str(marker)) + ').touch()\n')
        assert self.dispatch().returncode != 0
        assert not marker.exists()

    def test_exact_bundle_approval_can_be_revoked(self):
        hook = self.root / '.git-hooks/pre-commit'
        hook.write_text(hook.read_text() + '\necho reviewed-change\n')
        digest = self.tool('digest', installed=True, check=True).stdout.strip()
        self.tool('approve', '--digest', digest, installed=True, check=True)
        assert self.dispatch().returncode == 0
        self.git('config', '--local', '--unset-all', 'repo.trustedGateBundle')
        assert self.dispatch().returncode != 0

    def test_origin_and_symlink_changes_refuse_valid_bundle(self):
        assert self.dispatch().returncode == 0
        self.git('remote', 'set-url', 'origin', 'https://github.com/foreign/fixture.git')
        assert self.dispatch().returncode != 0
        slug = json.loads((self.root / 'config/agents/repository.json').read_text())['repo']
        self.git('remote', 'set-url', 'origin', 'https://github.com/' + slug + '.git')
        assert self.dispatch().returncode == 0
        hook = self.root / '.git-hooks/pre-commit'
        outside = self.scratch / 'outside-hook'
        outside.write_bytes(hook.read_bytes())
        outside.chmod(0o755)
        hook.unlink()
        hook.symlink_to(outside)
        assert self.dispatch().returncode != 0

    def test_actual_commits_scan_both_temporary_index_forms(self, subtests):
        for options in [('-a',), ('--', 'content.txt')]:
            with subtests.test(options=options):
                (self.root / 'content.txt').write_text('REPO_FIXTURE_SECRET\n')
                result = self.git('commit', '-m', 'must refuse', *options, check=False)
                assert result.returncode != 0, result.stdout + result.stderr
                assert 'fixture-secret-found' in result.stderr
                (self.root / 'content.txt').write_text('safe updated ' + str(options) + '\n')
                result = self.git('commit', '-m', 'safe commit', *options, check=False)
                assert result.returncode == 0, result.stdout + result.stderr


    def old_layout_fixture(self, frozen, manifest_path, *, restore=True):
        """Install a frozen real helper from the scripts/ layout it expects, then (by default)
        return the working tree to the current candidate. Its own FILES lay out the tree."""
        old = load_module(SOURCE / 'scripts/fixtures' / frozen)
        manifest = self.root / 'config/agents/repository.json'
        current_manifest = manifest.read_bytes()
        slug = json.loads(current_manifest)['repo']
        dispatcher = self.root / 'gate/hooks/pre-commit'
        current_dispatcher = dispatcher.read_bytes()
        call = '"$base/gate/repo-python.sh" "$base/gate/repo-hooks.py"'
        assert current_dispatcher.decode().count(call) == 1
        dispatcher.write_text(current_dispatcher.decode().replace(call, call.replace('gate/', 'scripts/')))
        moved = [rel for rel in old.FILES if rel.startswith('scripts/')]
        for rel in moved:
            target = self.root / rel
            target.parent.mkdir(exist_ok=True)
            shutil.copy2(self.root / rel.replace('scripts/', 'gate/', 1), target)
        (self.root / 'scripts/repo-hooks.py').write_bytes((SOURCE / 'scripts/fixtures' / frozen).read_bytes())
        if manifest_path != 'config/agents/repository.json':
            manifest.unlink()
        (self.root / manifest_path).write_text(json.dumps({'version': 1, 'repo': slug, 'files': old.FILES}))
        self.git('add', '-A')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'reviewed old layout')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.tool('install', script='scripts/repo-hooks.py', check=True)
        self.hooks = Path(self.git('config', '--get', 'core.hooksPath').stdout.strip())
        self.installed = self.hooks.parent / 'scripts/repo-hooks.py'
        if not restore:
            return None
        for rel in moved:
            (self.root / rel).unlink()
        (self.root / manifest_path).unlink(missing_ok=True)
        manifest.write_bytes(current_manifest)
        dispatcher.write_bytes(current_dispatcher)
        return self.tool('digest', check=True).stdout.strip()

    def legacy_upgrade_fixture(self):
        """Install the frozen real pre-relocation helper (root manifest, no scanner)."""
        return self.old_layout_fixture('repo-hooks-legacy.py', '.repo-independent.json')

    def scripts_layout_fixture(self, **options):
        """Install the frozen real helper from before the gate/ move (scripts/ trust files)."""
        return self.old_layout_fixture('repo-hooks-scripts-layout.py', 'config/agents/repository.json', **options)

    def test_scripts_layout_installation_upgrades_by_exact_reviewed_approval(self):
        digest = self.scripts_layout_fixture()
        old_version = self.hooks.parent
        assert sorted(path.name for path in self.hooks.iterdir()) == ['pre-commit', 'pre-push']
        # The new code accepts the installed old snapshot and reports it stale.
        result = self.tool('verify')
        assert result.returncode != 0
        assert 'Installed bundle is stale' in result.stderr
        # Until the upgrade, the old dispatcher and the installed old helper's approve cannot read the
        # new manifest, new dispatch refuses the old snapshot, and nothing installs unapproved.
        result = self.dispatch()
        assert result.returncode != 0
        assert 'Unknown manifest' in result.stderr
        result = self.tool('approve', '--digest', digest, installed=True)
        assert result.returncode != 0
        assert 'Unknown manifest' in result.stderr
        result = self.tool('dispatch')
        assert result.returncode != 0
        assert 'Trust implementation changed' in result.stderr
        result = self.tool('install')
        assert result.returncode != 0
        assert 'not reviewed origin/main' in result.stderr
        assert 'Installed format is current' in self.tool('approve-upgrade', '--digest', digest).stderr
        assert self.git('config', '--get', 'core.hooksPath').stdout.strip() == str(old_version / 'hooks')
        self.tool('approve', '--digest', digest, check=True)
        self.tool('install', check=True)
        self.tool('verify', check=True)
        self.hooks = Path(self.git('config', '--get', 'core.hooksPath').stdout.strip())
        assert self.hooks.parent.name == digest
        assert sorted(path.name for path in self.hooks.iterdir()) == ['pre-commit', 'pre-push']
        result = self.dispatch()
        assert result.returncode == 0, result.stderr
        assert 'fixture-root=' + str(self.root) in result.stdout

    def test_old_layout_tree_and_origin_main_are_never_trusted(self):
        self.scripts_layout_fixture(restore=False)
        before = (self.root / '.git/config').read_bytes()
        for command in (('digest',), ('approve', '--digest', '0' * 64), ('install',)):
            result = self.tool(*command)
            assert result.returncode != 0, command
            assert 'Unknown manifest' in result.stderr, command
        candidate = load_module(self.root / 'gate/repo-hooks.py')
        root, _, slug = candidate.context(self.root)
        with pytest.raises(ValueError, match='Unknown manifest'):
            candidate.bundle(root, slug, self.git('rev-parse', 'refs/remotes/origin/main').stdout.strip())
        assert (self.root / '.git/config').read_bytes() == before

    def test_protected_move_installs_over_scripts_layout_snapshot_without_approval(self):
        self.scripts_layout_fixture()
        self.git('add', '-A')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'reviewed gate move')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.tool('install', check=True)
        self.tool('verify', check=True)
        self.hooks = Path(self.git('config', '--get', 'core.hooksPath').stdout.strip())
        result = self.dispatch()
        assert result.returncode == 0, result.stderr
        assert 'fixture-root=' + str(self.root) in result.stdout
        assert self.git('config', '--get-all', 'repo.trustedGateBundle', check=False).returncode != 0

    def test_tampered_scripts_layout_snapshot_is_refused(self, subtests):
        digest = self.scripts_layout_fixture()
        version = self.hooks.parent
        for rel, refusal in (('gate/gate-lib.sh', 'Installed hook snapshot is corrupt'),
                             ('hooks/pre-commit', 'Installed dispatcher differs from its verified snapshot')):
            with subtests.test(path=rel):
                path = version / rel
                original = path.read_bytes()
                path.write_bytes(original + b'\n# tamper\n')
                try:
                    for command in (('verify',), ('approve', '--digest', digest)):
                        result = self.tool(*command)
                        assert result.returncode != 0, command
                        assert refusal in result.stderr, command
                finally:
                    path.write_bytes(original)
        assert self.git('config', '--get-all', 'repo.trustedGateBundle', check=False).returncode != 0
        # Restored bytes are the valid old snapshot again: stale, not refused.
        assert 'Installed bundle is stale' in self.tool('verify').stderr

    def test_actual_legacy_installation_upgrades_by_exact_reviewed_approval(self):
        digest = self.legacy_upgrade_fixture()
        assert self.tool('approve', '--digest', digest).returncode != 0
        assert self.tool('install').returncode != 0
        assert self.tool('approve-upgrade', '--digest', '0' * 64).returncode != 0
        self.tool('approve-upgrade', '--digest', digest, check=True)
        self.tool('approve-upgrade', '--digest', digest, check=True)
        values = self.git('config', '--get-all', 'repo.trustedGateBundle').stdout.splitlines()
        assert values.count(digest) == 1
        self.tool('install', check=True)
        self.tool('verify', check=True)
        self.tool('approve-upgrade', '--digest', digest, check=True)
        self.hooks = Path(self.git('config', '--get', 'core.hooksPath').stdout.strip())
        assert self.dispatch().returncode == 0

    def test_upgrade_reauthorizes_old_snapshot_and_preserves_failed_approval(self):
        digest = self.legacy_upgrade_fixture()
        self.git('update-ref', '-d', 'refs/remotes/origin/main')
        result = self.tool('approve-upgrade', '--digest', digest)
        assert result.returncode != 0
        assert 'Legacy installed bundle is not' in result.stderr
        assert self.git('config', '--get-all', 'repo.trustedGateBundle', check=False).returncode != 0
        old_digest = self.hooks.parent.name
        self.git('config', '--local', '--add', 'repo.trustedGateBundle', old_digest)
        self.tool('approve-upgrade', '--digest', digest, check=True)
        self.tool('install', check=True)

    def test_upgrade_refuses_snapshot_metadata_dispatcher_and_bundle_tamper(self, subtests):
        digest = self.legacy_upgrade_fixture()
        version = self.hooks.parent
        for rel in ('installation.json', 'hooks/pre-commit', 'gate/gate-lib.sh'):
            with subtests.test(path=rel):
                path = version / rel
                original = path.read_bytes()
                path.write_bytes(original + b'\n# tamper\n')
                assert self.tool('approve-upgrade', '--digest', digest).returncode != 0
                path.write_bytes(original)
        self.git('remote', 'set-url', 'origin', 'https://github.com/other/fixture.git')
        assert self.tool('approve-upgrade', '--digest', digest).returncode != 0

    def test_legacy_upgrade_refuses_unsafe_modes_without_changing_trust(self, subtests):
        digest = self.legacy_upgrade_fixture()
        version = self.hooks.parent
        self.git('config', '--local', '--add', 'repo.trustedGateBundle', version.name)
        config = self.root / '.git/config'
        before_config = config.read_bytes()
        before_approvals = self.git('config', '--get-all', 'repo.trustedGateBundle').stdout
        before_hooks = self.git('config', '--get', 'core.hooksPath').stdout
        cases = (('.repo-independent.json', 0o755),
                 ('installation.json', 0o666),
                 ('hooks/pre-commit', 0o744))
        for rel, unsafe_mode in cases:
            with subtests.test(path=rel, mode=oct(unsafe_mode)):
                path = version / rel
                original_mode = stat.S_IMODE(path.stat().st_mode)
                original_bytes = path.read_bytes()
                try:
                    path.chmod(unsafe_mode)
                    result = self.tool('approve-upgrade', '--digest', digest)
                    assert result.returncode != 0, result.stdout + result.stderr
                    assert config.read_bytes() == before_config
                    assert self.git('config', '--get-all', 'repo.trustedGateBundle').stdout == before_approvals
                    assert self.git('config', '--get', 'core.hooksPath').stdout == before_hooks
                    assert path.read_bytes() == original_bytes
                finally:
                    path.chmod(original_mode)
        # Each independent mode mutation is restored; the valid snapshot still upgrades.
        self.tool('approve-upgrade', '--digest', digest, check=True)
        self.tool('install', check=True)
        self.tool('verify', check=True)

    def test_existing_destination_with_extra_hook_is_refused_before_reconfiguration(self):
        digest = self.legacy_upgrade_fixture()
        self.tool('approve-upgrade', '--digest', digest, check=True)
        before = self.git('config', '--get', 'core.hooksPath').stdout
        candidate = load_module(self.root / 'gate/repo-hooks.py')
        _, common, slug = candidate.context(self.root)
        actual_digest, payload = candidate.bundle(self.root, slug)
        assert actual_digest == digest
        destination = candidate.snapshot(common / 'repo-hooks/versions', digest, payload, slug)
        extra = destination / 'hooks/post-checkout'
        extra.write_text('#!/bin/sh\ntouch "' + str(self.root / 'unreviewed-hook-ran') + '"\n')
        extra.chmod(0o755)
        result = self.tool('install')
        assert result.returncode != 0
        assert 'Unexpected hook' in result.stderr
        assert self.git('config', '--get', 'core.hooksPath').stdout == before
        self.git('checkout', '-q', '--detach', 'HEAD')
        assert not ((self.root / 'unreviewed-hook-ran').exists())

    def test_current_layout_refuses_old_missing_and_symlinked_manifest_owners(self):
        marker = self.root / 'config/agents/repository.json'
        original = marker.read_bytes()
        marker.unlink()
        result = self.tool('digest')
        assert result.returncode != 0
        assert 'Missing config/agents/repository.json' in result.stderr
        marker.write_bytes(original)
        retired = self.root / '.repo-independent.json'
        retired.symlink_to('missing')
        assert self.tool('digest').returncode != 0
        retired.unlink()
        marker.unlink(); marker.symlink_to(self.root / 'outside-manifest')
        assert self.tool('digest').returncode != 0

    def test_protected_new_source_installs_over_old_snapshot_without_approval(self):
        self.legacy_upgrade_fixture()
        self.git('add', '-A')
        self.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'reviewed new format')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.tool('install', check=True)
        self.tool('verify', check=True)
        assert self.git('config', '--get-all', 'repo.trustedGateBundle', check=False).returncode != 0

    def test_install_metadata_is_private_under_each_supported_umask(self, subtests):
        hook = self.root / '.git-hooks/pre-commit'
        for mask in (0o000, 0o022, 0o077):
            with subtests.test(umask=oct(mask)):
                hook.write_text(hook.read_text() + '\n# fresh snapshot for umask ' + oct(mask) + '\n')
                digest = self.tool('digest', check=True).stdout.strip()
                self.git('config', '--local', '--add', 'repo.trustedGateBundle', digest)
                for _ in range(2):
                    result = subprocess.run([sys.executable, '-I', str(self.root / 'gate/repo-hooks.py'),
                                             'install', '--root', str(self.root)], cwd=self.root,
                                            env=self.env, capture_output=True, text=True, umask=mask)
                    assert result.returncode == 0, result.stdout + result.stderr
                    self.tool('verify', check=True)
                configured = subprocess.check_output(['git', '-C', str(self.root), 'config', '--local',
                                                      '--get', 'core.hooksPath'], env=self.env, text=True).strip()
                metadata = Path(configured).parent / 'installation.json'
                assert stat.S_IMODE(metadata.stat().st_mode) == 0o600

    def test_install_rejects_invalid_fresh_snapshot_before_registration(self, subtests):
        current = load_module(self.root / 'gate/repo-hooks.py')
        root, common, slug = current.context(self.root)
        original_snapshot = current.snapshot
        hook = self.root / '.git-hooks/pre-commit'
        for failure in ('unsafe-mode', 'malformed-json'):
            with subtests.test(failure=failure):
                hook.write_text(hook.read_text() + '\n# new snapshot failure ' + failure + '\n')
                digest, payload = current.bundle(root, slug)
                self.git('config', '--local', '--add', 'repo.trustedGateBundle', digest)
                config = common / 'config'
                before = config.read_bytes()

                def corrupt_publication(parent, selected_digest, selected_payload, selected_slug):
                    version = original_snapshot(parent, selected_digest, selected_payload, selected_slug)
                    metadata = version / 'installation.json'
                    if failure == 'unsafe-mode':
                        metadata.chmod(0o666)
                    else:
                        metadata.write_text('{invalid-json')
                    return version

                with patch.object(current, 'snapshot', side_effect=corrupt_publication):
                    with pytest.raises(ValueError):
                        current.install(root, common, slug, digest, payload)
                assert config.read_bytes() == before




class TestPublicMiseBootstrap:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path):
        self.root = tmp_path.resolve()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        (self.root / 'gate').mkdir()
        shutil.copy2(SOURCE / 'gate/repo-python.sh', self.root / 'gate/repo-python.sh')
        for name in ('bash', 'chmod', 'cp', 'dirname', 'install', 'mktemp', 'rm'):
            (self.bin / name).symlink_to(shutil.which(name))
        (self.bin / 'python3').symlink_to(sys.executable)
        self.executions = self.root / 'executed'
        self.downloads = self.root / 'downloads'
        self.payload = self.root / 'downloaded-payload'
        self.payload.write_text('#!/usr/bin/env bash\nprintf "verified-run\\n" >> "$BOOTSTRAP_EXECUTIONS"\nprintf "mise fixture\\n"\n')
        self.script(self.bin / 'uname', '#!/usr/bin/env bash\nif [[ "$1" == -s ]]; then echo "${FIXTURE_SYSTEM:-Linux}"; else echo "${FIXTURE_ARCH:-x86_64}"; fi\n')
        self.script(self.bin / 'curl', '''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$BOOTSTRAP_DOWNLOADS"
[[ "${FIXTURE_DOWNLOAD_FAIL:-0}" != 1 ]] || exit 7
while [[ "$1" != -o ]]; do shift; done
cp "$BOOTSTRAP_PAYLOAD" "$2"
''')
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('GIT_', 'PYTHON'))}
        self.env.update(HOME=str(self.root), PATH=str(self.bin),
                        BOOTSTRAP_EXECUTIONS=str(self.executions), BOOTSTRAP_DOWNLOADS=str(self.downloads),
                        BOOTSTRAP_PAYLOAD=str(self.payload))

    @staticmethod
    def script(path, text):
        path.write_text(text)
        path.chmod(0o755)

    def provision(self, *, checksum=None, extra=None):
        import hashlib
        text = (SOURCE / 'gate/setup-agent-environment.sh').read_text()
        start = text.index('install_public_mise() (')
        body = text[start:text.index('\n)\n', start) + 3]
        assert body.count("destination='/usr/local/bin/mise'") == 1
        body = body.replace("destination='/usr/local/bin/mise'", "destination='" + str(self.bin / 'mise') + "'")
        digest = checksum or hashlib.sha256(self.payload.read_bytes()).hexdigest()
        for pinned in ('e79ae57945034903aee8aa2ea66b4c7ca9cd4f4edd5a8a78a589cbae6d0f428a',
                       'f344c6961190ed2f68e595ed7cb4f03c36c17812bd608886bec799a3082180ff'):
            assert body.count(pinned) == 1
            body = body.replace(pinned, digest)
        command = 'set -euo pipefail\nroot="$1"\n' + body + '\ninstall_public_mise\n'
        return subprocess.run([str(self.bin / 'bash'), '-c', command, 'fixture', str(self.root)],
                              cwd=self.root, env={**self.env, **(extra or {})},
                              text=True, capture_output=True)

    def test_verified_download_installs_once_without_global_config(self):
        result = self.provision()
        assert result.returncode == 0, result.stderr
        assert (self.bin / 'mise').read_bytes() == self.payload.read_bytes()
        assert stat.S_IMODE((self.bin / 'mise').stat().st_mode) == 0o755
        assert (self.executions.exists())
        result = self.provision()
        assert result.returncode == 0, result.stderr
        assert len(self.downloads.read_text().splitlines()) == 1
        assert not ((self.root / '.config/mise/config.toml').exists())

    def test_bad_checksum_never_executes_or_installs_download(self):
        result = self.provision(checksum='0' * 64)
        assert result.returncode != 0
        assert 'checksum' in result.stderr
        assert not (self.executions.exists())
        assert not ((self.bin / 'mise').exists())

    def test_failed_download_does_not_install(self):
        result = self.provision(extra={'FIXTURE_DOWNLOAD_FAIL': '1'})
        assert result.returncode != 0
        assert not (self.executions.exists())
        assert not ((self.bin / 'mise').exists())

    def test_unrunnable_verified_binary_is_not_installed(self):
        self.payload.write_text('#!/usr/bin/env bash\nexit 19\n')
        result = self.provision()
        assert result.returncode != 0
        assert not ((self.bin / 'mise').exists())

    def test_arm64_uses_its_pinned_release_asset(self):
        result = self.provision(extra={'FIXTURE_ARCH': 'aarch64'})
        assert result.returncode == 0, result.stderr
        assert 'mise-v2026.9.12-linux-arm64' in self.downloads.read_text()

    def test_unsupported_host_refuses_without_downloading(self):
        result = self.provision(extra={'FIXTURE_SYSTEM': 'Darwin'})
        assert result.returncode != 0
        assert 'Install mise' in result.stderr
        assert not (self.downloads.exists())
        assert not ((self.bin / 'mise').exists())

    def test_existing_nonexecutable_destination_is_preserved(self):
        destination = self.bin / 'mise'
        destination.write_text('existing useful content\n')
        destination.chmod(0o600)
        result = self.provision()
        assert result.returncode != 0
        assert destination.read_text() == 'existing useful content\n'
        assert not (self.downloads.exists())
