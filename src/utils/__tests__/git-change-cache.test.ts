import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    describe,
    expect,
    it
} from 'vitest';

import {
    GIT_CHANGE_REFRESH_FLAG,
    getCachedGitChangeCounts,
    refreshGitChangeCacheFromCli,
    resolveGitChangeRepo,
    type GitChangeCacheDeps,
    type GitChangeRepoIdentity
} from '../git-change-cache';

interface FakeFile {
    content: string;
    mtimeMs: number;
}

interface ExecCall {
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
}

interface TimedExecResponse {
    output: string;
    durationMs: number;
    after?: () => void;
}

type ExecResponse = Error | string | TimedExecResponse;

interface CacheHarness {
    cachePath: string;
    deps: GitChangeCacheDeps;
    execCalls: ExecCall[];
    files: Map<string, FakeFile>;
    renameCalls: { from: string; to: string }[];
    spawnCalls: { args: string[]; command: string }[];
    advanceNow: (milliseconds: number) => void;
    queueExec: (...responses: ExecResponse[]) => void;
    setIndexMtime: (mtimeMs: number) => void;
    setSelfArgs: (args: string[]) => void;
}

function createHarness(): CacheHarness {
    const cachePath = '/home/test/.cache/ccstatusline/git-changes/git-changes-worktree.json';
    const files = new Map<string, FakeFile>();
    const execCalls: ExecCall[] = [];
    const execResponses: ExecResponse[] = [];
    const renameCalls: { from: string; to: string }[] = [];
    const spawnCalls: { args: string[]; command: string }[] = [];
    let now = 1_700_000_000_000;
    let indexMtimeMs = 200;
    let selfArgs = ['/app/ccstatusline.js'];

    const resolveRepo = (): GitChangeRepoIdentity => ({
        root: '/repo/worktree',
        gitDir: '/repo/main/.git/worktrees/worktree',
        cachePath,
        headMtimeMs: 100,
        indexMtimeMs
    });

    const deps = {
        closeSync: () => undefined,
        execFileSync: ((_command, args, options) => {
            const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
            const normalizedOptions = options as {
                cwd?: string;
                env?: NodeJS.ProcessEnv;
                timeout?: number;
            };
            execCalls.push({
                args: normalizedArgs,
                cwd: normalizedOptions.cwd,
                env: normalizedOptions.env,
                timeout: normalizedOptions.timeout
            });
            const response = execResponses.shift();
            if (response instanceof Error) {
                throw response;
            }
            if (typeof response === 'object') {
                now += response.durationMs;
                response.after?.();
                return response.output;
            }
            return response ?? '';
        }) as GitChangeCacheDeps['execFileSync'],
        existsSync: filePath => files.has(String(filePath)),
        getExecPath: () => '/usr/bin/node',
        getSelfArgs: () => selfArgs,
        mkdirSync: () => undefined,
        now: () => now,
        openSync: ((filePath) => {
            const normalizedPath = String(filePath);
            if (files.has(normalizedPath)) {
                throw new Error('EEXIST');
            }
            files.set(normalizedPath, { content: '', mtimeMs: now });
            return 42;
        }) as GitChangeCacheDeps['openSync'],
        readFileSync: ((filePath) => {
            const entry = files.get(String(filePath));
            if (!entry) {
                throw new Error('ENOENT');
            }
            return entry.content;
        }) as GitChangeCacheDeps['readFileSync'],
        renameSync: ((from, to) => {
            const sourcePath = String(from);
            const targetPath = String(to);
            const entry = files.get(sourcePath);
            if (!entry) {
                throw new Error('ENOENT');
            }
            files.set(targetPath, { ...entry, mtimeMs: now });
            files.delete(sourcePath);
            renameCalls.push({ from: sourcePath, to: targetPath });
        }) as GitChangeCacheDeps['renameSync'],
        resolveRepo,
        spawn: ((command, args) => {
            spawnCalls.push({
                command,
                args: Array.isArray(args) ? args.map(String) : []
            });
            return { unref: () => undefined };
        }) as GitChangeCacheDeps['spawn'],
        statSync: ((filePath) => {
            const entry = files.get(String(filePath));
            if (!entry) {
                throw new Error('ENOENT');
            }
            return { mtimeMs: entry.mtimeMs };
        }) as GitChangeCacheDeps['statSync'],
        unlinkSync: (filePath) => {
            if (!files.delete(String(filePath))) {
                throw new Error('ENOENT');
            }
        },
        writeFileSync: ((filePath, content) => {
            if (typeof content !== 'string') {
                throw new Error('Expected string cache content');
            }
            files.set(String(filePath), { content, mtimeMs: now });
        }) as GitChangeCacheDeps['writeFileSync']
    } satisfies GitChangeCacheDeps;

    return {
        cachePath,
        deps,
        execCalls,
        files,
        renameCalls,
        spawnCalls,
        advanceNow: (milliseconds) => {
            now += milliseconds;
        },
        queueExec: (...responses) => {
            execResponses.push(...responses);
        },
        setIndexMtime: (mtimeMs) => {
            indexMtimeMs = mtimeMs;
        },
        setSelfArgs: (args) => {
            selfArgs = args;
        }
    };
}

function getLockPath(harness: CacheHarness): string {
    const lockPath = [...harness.files.keys()].find(filePath => filePath.endsWith('.lock'));
    if (!lockPath) {
        throw new Error('Expected refresh lock');
    }
    return lockPath;
}

function populateSnapshot(harness: CacheHarness): void {
    expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
    harness.queueExec(
        '2 files changed, 2 insertions(+), 1 deletion(-)',
        '2 files changed, 3 insertions(+), 4 deletions(-)'
    );
    refreshGitChangeCacheFromCli('/repo/worktree', getLockPath(harness), harness.deps);
}

describe('git change cache', () => {
    it('resolves linked worktrees to isolated cache identities', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-worktrees-'));
        try {
            const home = path.join(tempRoot, 'home');
            const commonGitDir = path.join(tempRoot, 'main', '.git', 'worktrees');
            const worktreeA = path.join(tempRoot, 'worktree-a');
            const worktreeB = path.join(tempRoot, 'worktree-b');
            const gitDirA = path.join(commonGitDir, 'worktree-a');
            const gitDirB = path.join(commonGitDir, 'worktree-b');
            fs.mkdirSync(path.join(worktreeA, 'nested'), { recursive: true });
            fs.mkdirSync(worktreeB, { recursive: true });
            fs.mkdirSync(gitDirA, { recursive: true });
            fs.mkdirSync(gitDirB, { recursive: true });
            fs.writeFileSync(path.join(worktreeA, '.git'), `gitdir: ${gitDirA}\n`, 'utf8');
            fs.writeFileSync(path.join(worktreeB, '.git'), `gitdir: ${gitDirB}\n`, 'utf8');
            for (const gitDir of [gitDirA, gitDirB]) {
                fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
                fs.writeFileSync(path.join(gitDir, 'index'), '', 'utf8');
            }

            const identityA = resolveGitChangeRepo(path.join(worktreeA, 'nested'), home);
            const identityB = resolveGitChangeRepo(worktreeB, home);

            expect(identityA?.root).toBe(worktreeA);
            expect(identityA?.gitDir).toBe(gitDirA);
            expect(identityB?.gitDir).toBe(gitDirB);
            expect(identityA?.cachePath).not.toBe(identityB?.cachePath);
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('returns unknown immediately and schedules one detached refresh on a miss', () => {
        const harness = createHarness();

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();

        expect(harness.spawnCalls).toHaveLength(1);
        expect(harness.spawnCalls[0]).toEqual({
            command: '/usr/bin/node',
            args: [
                '/app/ccstatusline.js',
                GIT_CHANGE_REFRESH_FLAG,
                '/repo/worktree',
                `${harness.cachePath}.lock`
            ]
        });
    });

    it('re-enters a compiled executable without a script-path argument', () => {
        const harness = createHarness();
        harness.setSelfArgs([]);

        getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps);

        expect(harness.spawnCalls[0]?.args).toEqual([
            GIT_CHANGE_REFRESH_FLAG,
            '/repo/worktree',
            `${harness.cachePath}.lock`
        ]);
    });

    it('atomically publishes combined staged and unstaged counts', () => {
        const harness = createHarness();
        populateSnapshot(harness);

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toEqual({
            insertions: 5,
            deletions: 5,
            refreshedAt: harness.deps.now(),
            stale: false
        });
        expect(harness.execCalls.map(call => call.args)).toEqual([
            ['diff', '--no-ext-diff', '--shortstat'],
            ['diff', '--cached', '--no-ext-diff', '--shortstat']
        ]);
        expect(harness.execCalls.every(call => call.cwd === '/repo/worktree')).toBe(true);
        expect(harness.execCalls.every(call => call.timeout === 5_000)).toBe(true);
        expect(harness.execCalls.every(call => call.env?.GIT_OPTIONAL_LOCKS === '0')).toBe(true);
        expect(harness.execCalls.every(call => call.env?.LC_ALL === 'C')).toBe(true);
        expect(harness.renameCalls).toHaveLength(1);
        expect(harness.renameCalls[0]?.to).toBe(harness.cachePath);
        expect([...harness.files.keys()].some(filePath => filePath.endsWith('.tmp'))).toBe(false);
        expect([...harness.files.keys()].some(filePath => filePath.endsWith('.lock'))).toBe(false);
    });

    it('records a successful clean diff as zero counts', () => {
        const harness = createHarness();
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        harness.queueExec('', '');

        refreshGitChangeCacheFromCli('/repo/worktree', getLockPath(harness), harness.deps);

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toMatchObject({
            insertions: 0,
            deletions: 0,
            stale: false
        });
    });

    it('returns stale data with a marker state while scheduling one refresh', () => {
        const harness = createHarness();
        populateSnapshot(harness);
        harness.advanceNow(5_001);

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toMatchObject({
            insertions: 5,
            deletions: 5,
            stale: true
        });
        expect(harness.spawnCalls).toHaveLength(2);
    });

    it('recovers a stale single-flight lock', () => {
        const harness = createHarness();
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        harness.advanceNow(30_001);

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();

        expect(harness.spawnCalls).toHaveLength(2);
    });

    it('invalidates a fresh snapshot when the worktree index changes', () => {
        const harness = createHarness();
        populateSnapshot(harness);
        harness.setIndexMtime(201);

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)?.stale).toBe(true);
        expect(harness.spawnCalls).toHaveLength(2);
    });

    it('keeps the last successful snapshot when a refresh fails', () => {
        const harness = createHarness();
        populateSnapshot(harness);
        harness.advanceNow(5_001);
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)?.stale).toBe(true);
        harness.queueExec(new Error('git timed out'));

        refreshGitChangeCacheFromCli('/repo/worktree', getLockPath(harness), harness.deps);

        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toMatchObject({
            insertions: 5,
            deletions: 5,
            stale: true
        });
    });

    it('shares one five-second deadline across both diff commands', () => {
        const harness = createHarness();
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        harness.queueExec(
            { output: '1 file changed, 2 insertions(+)', durationMs: 4_500 },
            { output: '1 file changed, 1 deletion(-)', durationMs: 0 }
        );

        refreshGitChangeCacheFromCli('/repo/worktree', getLockPath(harness), harness.deps);

        expect(harness.execCalls.map(call => call.timeout)).toEqual([5_000, 500]);
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toMatchObject({
            insertions: 2,
            deletions: 1,
            stale: false
        });
    });

    it('discards a snapshot when the index changes during refresh', () => {
        const harness = createHarness();
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        harness.queueExec(
            '1 file changed, 2 insertions(+)',
            {
                output: '1 file changed, 1 deletion(-)',
                durationMs: 0,
                after: () => {
                    harness.setIndexMtime(201);
                }
            }
        );

        refreshGitChangeCacheFromCli('/repo/worktree', getLockPath(harness), harness.deps);

        expect(harness.files.has(harness.cachePath)).toBe(false);
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
    });

    it('keeps a cold timeout unknown instead of publishing zero counts', () => {
        const harness = createHarness();
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        harness.queueExec(new Error('git timed out'));

        refreshGitChangeCacheFromCli('/repo/worktree', getLockPath(harness), harness.deps);

        expect(harness.files.has(harness.cachePath)).toBe(false);
        expect(getCachedGitChangeCounts('/repo/worktree', 5_000, harness.deps)).toBeNull();
        expect(harness.spawnCalls).toHaveLength(2);
    });

    it('rejects an unrelated lock path without running git or deleting it', () => {
        const harness = createHarness();
        harness.files.set('/tmp/unrelated.lock', { content: '', mtimeMs: harness.deps.now() });

        refreshGitChangeCacheFromCli('/repo/worktree', '/tmp/unrelated.lock', harness.deps);

        expect(harness.execCalls).toHaveLength(0);
        expect(harness.files.has('/tmp/unrelated.lock')).toBe(true);
    });
});
