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
    resolveDispatcherTools,
    resolveProviderRegistry,
    syncCCSwitchCommon
} from '../deploy-local';
import {
    buildManagedPatch,
    buildStatuslineDispatcher,
    collectJsonDifferencePaths,
    mergeManagedSettings,
    mergeProviderRegistries,
    parseCCSwitchCommonConfig,
    parseProviderRegistry,
    restoreManagedSettings,
    type JsonObject
} from '../deploy-utils';

const MANAGED_PATCH = buildManagedPatch('/workspace/.claude/statusline');
const MANAGED_PATCH_WITH_WIDGET_HOOKS = buildManagedPatch(
    '/workspace/.claude/statusline',
    [
        { event: 'PreToolUse', matcher: 'Skill' },
        { event: 'UserPromptSubmit' }
    ]
);

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
    it('parses the JSON object from CCSwitch common-config output', () => {
        expect(parseCCSwitchCommonConfig(`
Common Config Snippet
==================================================
App: claude

{
  "statusLine": {"command": "/legacy/ccswitch-statusline"},
  "enableWorkflows": true
}
`)).toEqual({
            enableWorkflows: true,
            statusLine: { command: '/legacy/ccswitch-statusline' }
        });
    });

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

    it('preserves sibling commands inside an entry that contains a managed hook', () => {
        const source = {
            hooks: {
                SessionStart: [{
                    matcher: '',
                    hooks: [
                        {
                            type: 'command',
                            command: '/workspace/.claude/statusline/bin/ccstatusline-hook'
                        },
                        { type: 'command', command: '/security/audit-session.sh' }
                    ]
                }],
                Stop: [{
                    hooks: [{
                        type: 'command',
                        command: '/security/audit.sh --note /ccstatusline-hook'
                    }]
                }]
            }
        };

        const merged = mergeManagedSettings(source, MANAGED_PATCH);
        const serialized = JSON.stringify(merged.hooks);

        expect(serialized).toContain('/security/audit-session.sh');
        expect(serialized).toContain('/security/audit.sh --note /ccstatusline-hook');
        expect(serialized.match(/\/ccstatusline-hook/g)).toHaveLength(5);
    });

    it('restores only managed commands without restoring backup sibling commands', () => {
        const current = {
            hooks: {
                SessionStart: [{
                    matcher: '',
                    hooks: [
                        { type: 'command', command: '/current/bin/ccstatusline-hook' },
                        { type: 'command', command: '/security/current-audit.sh' }
                    ]
                }]
            }
        };
        const backup = {
            hooks: {
                SessionStart: [{
                    matcher: '',
                    hooks: [
                        { type: 'command', command: '/old/bin/ccstatusline-hook' },
                        { type: 'command', command: '/backup/unrelated-audit.sh' }
                    ]
                }]
            }
        };

        const restored = restoreManagedSettings(current, backup, MANAGED_PATCH);
        const serialized = JSON.stringify(restored.hooks);

        expect(serialized).toContain('/old/bin/ccstatusline-hook');
        expect(serialized).toContain('/security/current-audit.sh');
        expect(serialized).not.toContain('/current/bin/ccstatusline-hook');
        expect(serialized).not.toContain('/backup/unrelated-audit.sh');
    });

    it('installs configured widget hooks through the stable hook dispatcher', () => {
        const merged = mergeManagedSettings({}, MANAGED_PATCH_WITH_WIDGET_HOOKS);
        const hooks = merged.hooks as Record<string, JsonObject[]>;

        expect(hooks.PreToolUse).toEqual([{
            matcher: 'Skill',
            hooks: [{
                type: 'command',
                command: '/workspace/.claude/statusline/bin/ccstatusline-hook',
                timeout: 2
            }]
        }]);
        expect(hooks.UserPromptSubmit).toEqual([{
            hooks: [{
                type: 'command',
                command: '/workspace/.claude/statusline/bin/ccstatusline-hook',
                timeout: 2
            }]
        }]);
    });

    it('migrates a CCSwitch common snippet while preserving unrelated fields', () => {
        const common = {
            enableWorkflows: true,
            hooks: {
                SessionStart: [{
                    matcher: '',
                    hooks: [{
                        type: 'command',
                        command: '/workspace/.claude/statusline/bin/ccswitch-statusline-hook'
                    }]
                }],
                Stop: [{
                    matcher: '',
                    hooks: [{ type: 'command', command: '/existing/stop.sh' }]
                }]
            },
            statusLine: { command: '/workspace/.claude/statusline/bin/ccswitch-statusline' }
        };
        const merged = mergeManagedSettings(common, MANAGED_PATCH_WITH_WIDGET_HOOKS);
        const hooks = merged.hooks as Record<string, JsonObject[]>;

        expect(merged.enableWorkflows).toBe(true);
        expect(JSON.stringify(merged)).not.toContain('/ccswitch-statusline');
        expect(JSON.stringify(merged.statusLine)).toContain('/bin/ccstatusline');
        expect(hooks.Stop).toEqual(common.hooks.Stop);
        expect(hooks.PreToolUse).toHaveLength(1);
        expect(hooks.UserPromptSubmit).toHaveLength(1);
    });

    it('removes obsolete managed widget hooks while preserving unrelated hooks', () => {
        const installed = mergeManagedSettings({
            hooks: {
                PreToolUse: [{
                    matcher: 'Bash',
                    hooks: [{ type: 'command', command: '/existing/pre-tool-use.sh' }]
                }]
            }
        }, MANAGED_PATCH_WITH_WIDGET_HOOKS);
        const merged = mergeManagedSettings(installed, MANAGED_PATCH);
        const hooks = merged.hooks as Record<string, JsonObject[]>;

        expect(hooks.PreToolUse).toEqual([{
            matcher: 'Bash',
            hooks: [{ type: 'command', command: '/existing/pre-tool-use.sh' }]
        }]);
        expect(hooks.UserPromptSubmit).toBeUndefined();
    });

    it('live-merges CCSwitch common config without exposing values in argv', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-common-sync-'));
        try {
            const home = path.join(root, 'home');
            const configRoot = path.join(home, '.claude');
            const settingsPath = path.join(configRoot, 'settings.json');
            const installRoot = path.join(configRoot, 'statusline');
            const ccSwitchRoot = path.join(root, 'ccswitch');
            const commonStatePath = path.join(ccSwitchRoot, 'common.json');
            const argumentLogPath = path.join(root, 'arguments.jsonl');
            const fakeCCSwitch = path.join(root, 'cc-switch');
            const sensitiveValue = 'test-sensitive-common-value';
            fs.mkdirSync(configRoot, { recursive: true });
            fs.mkdirSync(ccSwitchRoot, { recursive: true });
            fs.writeFileSync(settingsPath, '{}\n');

            const paths = resolveDeploymentPaths({
                CCSTATUSLINE_INSTALL_ROOT: installRoot,
                CCSTATUSLINE_SETTINGS_PATH: settingsPath,
                HOME: home
            });
            const staleCurrent = { credentialField: sensitiveValue };
            const staleNext = mergeManagedSettings(
                staleCurrent,
                buildManagedPatch(installRoot)
            );
            const concurrentStopHook = {
                command: '/concurrent/stop.sh',
                type: 'command'
            };
            fs.writeFileSync(commonStatePath, `${JSON.stringify({
                concurrentField: 'keep',
                credentialField: sensitiveValue,
                hooks: { Stop: [{ hooks: [concurrentStopHook] }] }
            })}\n`);
            fs.writeFileSync(fakeCCSwitch, `#!/usr/bin/env bun
import * as fs from 'node:fs';
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(commonStatePath)};
const argumentLogPath = ${JSON.stringify(argumentLogPath)};
const configRoot = ${JSON.stringify(ccSwitchRoot)};
fs.appendFileSync(argumentLogPath, \`\${JSON.stringify(args)}\\n\`);
if (args[0] === 'config' && args[1] === 'path') {
    console.log(\`Config dir: \${configRoot}\`);
} else if (args.includes('show')) {
    process.stdout.write(fs.readFileSync(statePath, 'utf8'));
} else if (args.includes('set')) {
    const fileIndex = args.indexOf('--file');
    const snippetIndex = args.indexOf('--snippet');
    const content = fileIndex >= 0
        ? fs.readFileSync(args[fileIndex + 1], 'utf8')
        : args[snippetIndex + 1];
    fs.writeFileSync(statePath, \`\${content}\\n\`);
} else {
    process.exitCode = 1;
}
`, { mode: 0o755 });

            syncCCSwitchCommon(paths, {
                command: fakeCCSwitch,
                current: staleCurrent,
                next: staleNext
            });

            const applied = JSON.parse(fs.readFileSync(commonStatePath, 'utf8')) as JsonObject;
            const argumentLog = fs.readFileSync(argumentLogPath, 'utf8');
            expect(applied.concurrentField).toBe('keep');
            expect(applied.credentialField).toBe(sensitiveValue);
            expect(JSON.stringify(applied.hooks)).toContain('/concurrent/stop.sh');
            expect(argumentLog).toContain('"--file"');
            expect(argumentLog).not.toContain('"--snippet"');
            expect(argumentLog).not.toContain(sensitiveValue);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('restores managed widget hooks recorded by the backup even after the layout changes', () => {
        const backup = mergeManagedSettings({}, MANAGED_PATCH_WITH_WIDGET_HOOKS);
        const current = mergeManagedSettings(backup, MANAGED_PATCH);
        const restored = restoreManagedSettings(current, backup, MANAGED_PATCH);
        const hooks = restored.hooks as Record<string, JsonObject[]>;

        expect(hooks.PreToolUse).toEqual(
            (backup.hooks as Record<string, JsonObject[]>).PreToolUse
        );
        expect(hooks.UserPromptSubmit).toEqual(
            (backup.hooks as Record<string, JsonObject[]>).UserPromptSubmit
        );
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

    it('preserves concurrent CCSwitch common fields and hooks during rollback', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-common-rollback-'));
        try {
            const home = path.join(root, 'home');
            const configRoot = path.join(home, '.claude');
            const settingsPath = path.join(configRoot, 'settings.json');
            const backupBase = path.join(configRoot, 'backups', 'ccstatusline');
            const installRoot = path.join(configRoot, 'statusline');
            const backupRoot = path.join(backupBase, '20260802-rollback-statusline-setup');
            const ccSwitchRoot = path.join(root, 'ccswitch');
            const commonStatePath = path.join(ccSwitchRoot, 'common.json');
            const fakeCCSwitch = path.join(root, 'cc-switch');
            fs.mkdirSync(backupRoot, { recursive: true });
            fs.mkdirSync(ccSwitchRoot, { recursive: true });
            fs.mkdirSync(configRoot, { recursive: true });
            fs.writeFileSync(settingsPath, '{}\n');
            fs.writeFileSync(path.join(backupRoot, 'claude-settings.json'), '{}\n');

            const oldPatch = buildManagedPatch('/old/statusline');
            const backupCommon = mergeManagedSettings({
                enableWorkflows: true,
                originalField: 'old'
            }, oldPatch);
            const currentCommon = mergeManagedSettings({
                concurrentField: 'keep',
                enableWorkflows: false,
                hooks: {
                    Stop: [{
                        matcher: 'concurrent',
                        hooks: [{ type: 'command', command: '/concurrent/stop.sh' }]
                    }]
                }
            }, buildManagedPatch(installRoot));
            fs.writeFileSync(commonStatePath, `${JSON.stringify(currentCommon)}\n`);
            fs.writeFileSync(
                path.join(backupRoot, 'cc-switch-common.json'),
                `${JSON.stringify(backupCommon)}\n`
            );
            fs.writeFileSync(
                path.join(backupRoot, 'metadata.json'),
                `${JSON.stringify({
                    activeRelease: null,
                    createdAt: '2026-08-02T00:00:00.000Z',
                    hadCcSwitchCommon: true,
                    hadSettings: true,
                    paths: {
                        backupRoot: backupBase,
                        settingsPath,
                        targetRoot: installRoot
                    },
                    previousRelease: null,
                    retainUntil: '2026-08-09T00:00:00.000Z',
                    version: 5
                })}\n`
            );
            fs.writeFileSync(fakeCCSwitch, `#!/usr/bin/env bun
import * as fs from 'node:fs';
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(commonStatePath)};
const configRoot = ${JSON.stringify(ccSwitchRoot)};
if (args[0] === 'config' && args[1] === 'path') {
    console.log(\`Config dir: \${configRoot}\`);
} else if (args.includes('show')) {
    process.stdout.write(fs.readFileSync(statePath, 'utf8'));
} else if (args.includes('set')) {
    const fileIndex = args.indexOf('--file');
    const snippetIndex = args.indexOf('--snippet');
    const content = fileIndex >= 0
        ? fs.readFileSync(args[fileIndex + 1], 'utf8')
        : args[snippetIndex + 1];
    fs.writeFileSync(statePath, \`\${content}\\n\`);
} else {
    process.exitCode = 1;
}
`, { mode: 0o755 });

            const result = spawnSync(
                process.execPath,
                [path.resolve('scripts/deploy-local.ts'), '--rollback', backupRoot],
                {
                    cwd: path.resolve('.'),
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        CCSTATUSLINE_BACKUP_ROOT: backupBase,
                        CCSTATUSLINE_CCSWITCH_COMMAND: fakeCCSwitch,
                        CCSTATUSLINE_INSTALL_ROOT: installRoot,
                        CCSTATUSLINE_SETTINGS_PATH: settingsPath,
                        CLAUDE_CONFIG_DIR: configRoot,
                        HOME: home
                    }
                }
            );
            expect(result.status, result.stderr).toBe(0);

            const restored = JSON.parse(fs.readFileSync(commonStatePath, 'utf8')) as JsonObject;
            const hooks = restored.hooks as Record<string, JsonObject[]>;
            expect(restored.concurrentField).toBe('keep');
            expect(restored.enableWorkflows).toBe(false);
            expect(restored.statusLine).toEqual(backupCommon.statusLine);
            expect(restored.subagentStatusLine).toEqual(backupCommon.subagentStatusLine);
            expect(JSON.stringify(hooks.Stop)).toContain('/concurrent/stop.sh');
            expect(JSON.stringify(hooks.SessionStart)).toContain('/old/statusline');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
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
    it('selects stock macOS shasum when sha256sum is unavailable', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-shasum-tools-'));
        const originalPath = process.env.PATH;
        try {
            const toolsRoot = path.join(root, 'bin');
            fs.mkdirSync(toolsRoot);
            for (const tool of ['find', 'mktemp', 'sed']) {
                fs.symlinkSync(`/usr/bin/${tool}`, path.join(toolsRoot, tool));
            }
            const shasumPath = path.join(toolsRoot, 'shasum');
            fs.writeFileSync(shasumPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
            process.env.PATH = toolsRoot;

            expect(resolveDispatcherTools()).toEqual({
                findPath: path.join(toolsRoot, 'find'),
                mktempPath: path.join(toolsRoot, 'mktemp'),
                sedPath: path.join(toolsRoot, 'sed'),
                sha256Args: ['-a', '256'],
                sha256Path: shasumPath
            });
        } finally {
            if (originalPath === undefined) {
                delete process.env.PATH;
            } else {
                process.env.PATH = originalPath;
            }
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

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

    it('runs with a shasum-only toolset and no GNU timeout', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-macos-tools-'));
        try {
            const targetRoot = path.join(root, 'statusline');
            const releaseId = 'b'.repeat(64);
            const releaseBin = path.join(targetRoot, 'releases', releaseId, 'bin');
            const home = path.join(root, 'home');
            const fakeShasum = path.join(root, 'shasum');
            const fakeSleep = path.join(root, 'sleep');
            const hashArguments = path.join(root, 'shasum-arguments');
            const sleepPidPath = path.join(root, 'sleep-pid');
            fs.mkdirSync(releaseBin, { recursive: true });
            fs.mkdirSync(home, { recursive: true });
            fs.writeFileSync(path.join(targetRoot, 'active-release'), `${releaseId}\n`);
            fs.writeFileSync(path.join(releaseBin, 'ccstatusline-render'), `#!/bin/sh
cat >/dev/null
printf '%s\\n' 'LIVE-MACOS'
`, { mode: 0o755 });
            fs.writeFileSync(fakeShasum, `#!/bin/sh
printf '%s\\n' "$*" > ${JSON.stringify(hashArguments)}
[ "$1" = '-a' ] && [ "$2" = '256' ] || exit 64
exec /usr/bin/sha256sum
`, { mode: 0o755 });
            fs.writeFileSync(fakeSleep, `#!/bin/sh
printf '%s\\n' "$$" > ${JSON.stringify(sleepPidPath)}
exec /bin/sleep "$@"
`, { mode: 0o755 });

            const dispatcher = path.join(targetRoot, 'dispatcher');
            fs.writeFileSync(dispatcher, buildStatuslineDispatcher({
                targetRoot,
                sedPath: '/usr/bin/sed',
                sha256Path: fakeShasum,
                sha256Args: ['-a', '256'],
                findPath: '/usr/bin/find',
                mktempPath: '/usr/bin/mktemp',
                warmTimeout: '1s',
                coldTimeout: '2s'
            }), { mode: 0o755 });

            const result = spawnSync(dispatcher, [], {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    HOME: home,
                    PATH: `${root}:${process.env.PATH ?? ''}`
                },
                input: `${JSON.stringify({ session_id: 'macos-session' })}\n`
            });

            expect(result.status, result.stderr).toBe(0);
            expect(result.stdout).toBe('LIVE-MACOS\n');
            expect(fs.readFileSync(hashArguments, 'utf8').trim()).toBe('-a 256');
            const sleepPid = Number(fs.readFileSync(sleepPidPath, 'utf8').trim());
            expect(() => process.kill(sleepPid, 0)).toThrow();
            expect(fs.readFileSync(dispatcher, 'utf8')).not.toContain('missing-gnu-timeout');
            expect(fs.readFileSync(dispatcher, 'utf8')).not.toContain('--kill-after');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects timeout strings that could alter the generated shell command', () => {
        expect(() => buildStatuslineDispatcher({
            targetRoot: '/workspace/.claude/statusline',
            sedPath: '/usr/bin/sed',
            sha256Path: '/usr/bin/sha256sum',
            findPath: '/usr/bin/find',
            mktempPath: '/usr/bin/mktemp',
            warmTimeout: '1s; false'
        })).toThrow('warmTimeout must be a timeout duration');
    });
});
