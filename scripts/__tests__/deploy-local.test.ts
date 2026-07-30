import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    resolveDeploymentPaths,
    resolveProviderRegistry
} from '../deploy-local';
import {
    buildManagedPatch,
    buildStatuslineDispatcher,
    collectJsonDifferencePaths,
    mergeManagedSettings,
    mergeProviderRegistries,
    parseProviderRegistry,
    restoreManagedSettings
} from '../deploy-utils';

const MANAGED_PATCH = buildManagedPatch('/workspace/.claude/statusline');

describe('portable deployment path resolution', () => {
    it('uses the Claude config directory regardless of repository checkout location', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-paths-'));
        try {
            const paths = resolveDeploymentPaths({ HOME: path.join(root, 'home') });
            expect(paths.configuredSettingsPath).toBe(
                path.join(root, 'home', '.claude', 'settings.json')
            );
            expect(paths.settingsPath).toBe(paths.configuredSettingsPath);
            expect(paths.targetRoot).toBe(path.join(root, 'home', '.claude', 'statusline'));
            expect(paths.backupRoot).toBe(
                path.join(root, 'home', '.claude', 'backups', 'ccstatusline')
            );
            expect(paths.targetRoot).not.toContain(paths.repoRoot);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('places the install beside the canonical target of symlinked Claude settings', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-authority-'));
        try {
            const runtimeRoot = path.join(root, 'runtime', '.claude');
            const persistentRoot = path.join(root, 'persistent', '.claude');
            fs.mkdirSync(runtimeRoot, { recursive: true });
            fs.mkdirSync(persistentRoot, { recursive: true });
            fs.writeFileSync(path.join(persistentRoot, 'settings.json'), '{}\n');
            fs.symlinkSync(
                path.join(persistentRoot, 'settings.json'),
                path.join(runtimeRoot, 'settings.json')
            );

            const paths = resolveDeploymentPaths({
                CLAUDE_CONFIG_DIR: runtimeRoot,
                HOME: path.join(root, 'runtime')
            });
            expect(paths.configuredSettingsPath).toBe(
                path.join(runtimeRoot, 'settings.json')
            );
            expect(paths.settingsPath).toBe(path.join(persistentRoot, 'settings.json'));
            expect(paths.targetRoot).toBe(path.join(persistentRoot, 'statusline'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a dangling settings symlink before it can be replaced', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-dangling-'));
        try {
            const configRoot = path.join(root, '.claude');
            fs.mkdirSync(configRoot);
            fs.symlinkSync(
                path.join(root, 'missing-settings.json'),
                path.join(configRoot, 'settings.json')
            );

            expect(() => resolveDeploymentPaths({
                CLAUDE_CONFIG_DIR: configRoot,
                HOME: root
            })).toThrow('Claude settings symlink is unresolved');
            expect(fs.lstatSync(path.join(configRoot, 'settings.json')).isSymbolicLink())
                .toBe(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('local deployment settings merge', () => {
    it('reports structural read-back differences without including values', () => {
        expect(collectJsonDifferencePaths(
            { hooks: [{ timeout: 2 }], statusLine: { padding: 0 } },
            { hooks: [{ timeout: 5 }], statusLine: {} }
        )).toEqual(['$.hooks[0].timeout', '$.statusLine.padding']);
    });

    it('preserves unrelated fields and hook events', () => {
        const source = {
            enableWorkflows: true,
            hooks: {
                Stop: [{
                    matcher: '',
                    hooks: [{ type: 'command', command: '/existing/stop.sh' }]
                }]
            }
        };

        const merged = mergeManagedSettings(source, MANAGED_PATCH);

        expect(merged.enableWorkflows).toBe(true);
        expect((merged.hooks as Record<string, unknown>).Stop).toEqual(source.hooks.Stop);
        expect(merged.statusLine).toBeDefined();
        expect(merged.subagentStatusLine).toBeDefined();
    });

    it('replaces prior managed hook entries without duplicating them', () => {
        const source = mergeManagedSettings({}, MANAGED_PATCH);
        const merged = mergeManagedSettings(source, MANAGED_PATCH);
        const hooks = merged.hooks as Record<string, unknown[]>;

        for (const event of ['SessionStart', 'SubagentStart', 'SubagentStop', 'SessionEnd']) {
            expect(hooks[event]).toHaveLength(1);
        }
    });

    it('restores only owned settings fields and preserves concurrent unrelated changes', () => {
        const oldPatch = {
            ...buildManagedPatch('/workspace/.config/claude-code/statusline'),
            hooks: {
                SessionStart: [{
                    matcher: '',
                    hooks: [{
                        type: 'command',
                        command: '/workspace/.config/claude-code/statusline/bin/ccswitch-statusline-hook',
                        timeout: 2
                    }]
                }]
            }
        };
        const current = mergeManagedSettings({
            concurrentField: 'keep',
            hooks: {
                SessionStart: [{
                    matcher: 'concurrent',
                    hooks: [{ type: 'command', command: '/concurrent/start.sh' }]
                }]
            }
        }, MANAGED_PATCH);
        const backup = mergeManagedSettings({ originalField: 'old' }, oldPatch);

        const restored = restoreManagedSettings(current, backup, MANAGED_PATCH);
        const hooks = restored.hooks as Record<string, unknown[]>;

        expect(restored.concurrentField).toBe('keep');
        expect(restored.statusLine).toEqual(backup.statusLine);
        expect(restored.subagentStatusLine).toEqual(backup.subagentStatusLine);
        expect(hooks.SessionStart).toHaveLength(2);
        expect(JSON.stringify(hooks.SessionStart)).toContain('/concurrent/start.sh');
        expect(JSON.stringify(hooks.SessionStart)).toContain(
            '/workspace/.config/claude-code/statusline'
        );
    });

    it('parses the public CCSwitch provider table without retaining URL paths', () => {
        const registry = parseProviderRegistry(`
┌───┬──────────────────────────────────────┬─────────────────┬────────────────────────────────────────────────┐
│   ┆ ID                                   ┆ Name            ┆ API URL                                        │
╞═══╪══════════════════════════════════════╪═════════════════╪════════════════════════════════════════════════╡
│   ┆ claude-official                      ┆ Claude Official ┆ N/A                                            │
│ ✓ ┆ provider-id                          ┆ ClipProxyAPI    ┆ http://localhost:8317/anthropic?secret=redacted │
└───┴──────────────────────────────────────┴─────────────────┴────────────────────────────────────────────────┘
`);
        const providers = (registry?.providers ?? []) as Record<string, unknown>[];

        expect(registry).not.toBeNull();
        expect(providers).toEqual([
            {
                id: 'claude-official',
                displayName: 'Claude Official',
                origins: []
            },
            {
                id: 'provider-id',
                displayName: 'ClipProxyAPI',
                origins: ['http://localhost:8317'],
                hostnames: ['localhost']
            }
        ]);
        expect(JSON.stringify(registry)).not.toContain('secret');
        expect(JSON.stringify(registry)).not.toContain('/anthropic');
    });

    it('merges discovered providers with the bundled fallback registry', () => {
        expect(mergeProviderRegistries(
            {
                version: 1,
                providers: [{ id: 'claude-official', displayName: 'Claude Official' }]
            },
            {
                version: 1,
                providers: [{ id: 'local-provider', displayName: 'Local Provider' }]
            }
        )).toEqual({
            version: 1,
            providers: [
                { id: 'claude-official', displayName: 'Claude Official' },
                { id: 'local-provider', displayName: 'Local Provider' }
            ]
        });
    });
});

describe('optional CCSwitch provider discovery', () => {
    const baseline = {
        version: 1,
        providers: [{ id: 'claude-official', displayName: 'Claude Official' }]
    };

    it('succeeds with bundled providers when CCSwitch is absent in auto mode', () => {
        const result = resolveProviderRegistry('auto', baseline, () => {
            throw new Error('command unavailable');
        });

        expect(result.source).toBe('bundled');
        expect(result.registry).toEqual(baseline);
        expect(result.warning).toContain('using bundled provider registry');
    });

    it('skips CCSwitch discovery in off mode', () => {
        const discover = vi.fn(() => '');
        const result = resolveProviderRegistry('off', baseline, discover);

        expect(result.source).toBe('bundled');
        expect(discover).not.toHaveBeenCalled();
    });

    it('fails closed before deployment when CCSwitch is required', () => {
        expect(() => resolveProviderRegistry('required', baseline, () => {
            throw new Error('command unavailable');
        })).toThrow('CCSwitch provider discovery is required and unavailable');
    });
});

describe('last-known-good statusline dispatcher', () => {
    it('never emits an empty refresh and isolates cached output by session and mode', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-dispatcher-'));
        try {
            const targetRoot = path.join(root, 'statusline');
            const releaseRoot = path.join(targetRoot, 'releases', 'test-release');
            const releaseBin = path.join(releaseRoot, 'bin');
            const home = path.join(root, 'home');
            const cacheHome = path.join(home, 'cache');
            fs.mkdirSync(releaseBin, { recursive: true });
            fs.mkdirSync(home, { recursive: true });
            const releaseId = 'a'.repeat(64);
            fs.renameSync(
                path.join(targetRoot, 'releases', 'test-release'),
                path.join(targetRoot, 'releases', releaseId)
            );
            const activeRelease = path.join(targetRoot, 'active-release');
            fs.writeFileSync(activeRelease, `${releaseId}\n`);

            const renderer = path.join(targetRoot, 'releases', releaseId, 'bin', 'ccstatusline-render');
            fs.writeFileSync(renderer, `#!/bin/sh
payload=$(cat)
case "$payload" in
  *'"mode":"slow"'*) sleep 1; printf '%s\\n' 'LATE' ;;
  *'"mode":"error"'*) exit 42 ;;
  *'"label":"B"'*) printf '%s\\n' 'LIVE-B' ;;
  *) printf '%s\\n' 'LIVE-A' ;;
esac
`, { mode: 0o755 });

            const dispatcher = path.join(targetRoot, 'dispatcher');
            fs.writeFileSync(dispatcher, buildStatuslineDispatcher({
                targetRoot,
                timeoutPath: '/usr/bin/timeout',
                sedPath: '/usr/bin/sed',
                sha256Path: '/usr/bin/sha256sum',
                findPath: '/usr/bin/find',
                mktempPath: '/usr/bin/mktemp',
                warmTimeout: '0.05s',
                coldTimeout: '0.2s'
            }), { mode: 0o755 });

            const run = (sessionId: string, mode: string, label = 'A', args: string[] = []) => {
                return spawnSync(dispatcher, args, {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        HOME: home,
                        XDG_CACHE_HOME: cacheHome
                    },
                    input: `${JSON.stringify({ session_id: sessionId, mode, label })}\n`
                });
            };

            const firstA = run('session-a', 'fast');
            expect(firstA.status).toBe(0);
            expect(firstA.stdout).toBe('LIVE-A\n');

            const slowA = run('session-a', 'slow');
            expect(slowA.status).toBe(0);
            expect(slowA.stdout).toBe('LIVE-A\n');

            const errorA = run('session-a', 'error');
            expect(errorA.status).toBe(0);
            expect(errorA.stdout).toBe('LIVE-A\n');

            const coldB = run('session-b', 'slow', 'B');
            expect(coldB.status).toBe(0);
            expect(coldB.stdout).toContain('Statusline refreshing');
            expect(coldB.stdout).not.toContain('LIVE-A');

            expect(run('session-b', 'fast', 'B').stdout).toBe('LIVE-B\n');
            expect(run('session-b', 'slow', 'B').stdout).toBe('LIVE-B\n');

            const subagentA = run('session-a', 'slow', 'A', ['--subagent']);
            expect(subagentA.status).toBe(0);
            expect(subagentA.stdout).toContain('Statusline refreshing');
            expect(subagentA.stdout).not.toContain('LIVE-A');

            const cacheFiles = fs.readdirSync(path.join(cacheHome, 'ccstatusline', 'last-good'))
                .filter(file => file.endsWith('.ansi'));
            expect(cacheFiles).toHaveLength(2);
            for (const file of cacheFiles) {
                const mode = fs.statSync(path.join(
                    cacheHome,
                    'ccstatusline',
                    'last-good',
                    file
                )).mode & 0o777;
                expect(mode).toBe(0o600);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects timeout strings that could alter the generated shell command', () => {
        expect(() => buildStatuslineDispatcher({
            targetRoot: '/workspace/.claude/statusline',
            timeoutPath: '/usr/bin/timeout',
            sedPath: '/usr/bin/sed',
            sha256Path: '/usr/bin/sha256sum',
            findPath: '/usr/bin/find',
            mktempPath: '/usr/bin/mktemp',
            warmTimeout: '1s; false'
        })).toThrow('warmTimeout must be a timeout duration');
    });
});
