import {
    execFileSync,
    spawn
} from 'child_process';
import { createHash } from 'node:crypto';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface GitChangeSnapshot {
    insertions: number;
    deletions: number;
    refreshedAt: number;
    stale: boolean;
}

export interface GitChangeRepoIdentity {
    root: string;
    gitDir: string;
    cachePath: string;
    headMtimeMs: number | null;
    indexMtimeMs: number | null;
}

interface StoredGitChangeSnapshot {
    version: 1;
    root: string;
    gitDir: string;
    refreshedAt: number;
    headMtimeMs: number | null;
    indexMtimeMs: number | null;
    insertions: number;
    deletions: number;
}

interface GitDiffResult {
    insertions: number;
    deletions: number;
}

interface CachedGitChangeSnapshot {
    data: StoredGitChangeSnapshot;
    stale: boolean;
}

export interface GitChangeCacheDeps {
    closeSync: typeof closeSync;
    execFileSync: typeof execFileSync;
    existsSync: typeof existsSync;
    getExecPath: () => string;
    getSelfArgs: () => string[];
    mkdirSync: typeof mkdirSync;
    now: typeof Date.now;
    openSync: typeof openSync;
    readFileSync: typeof readFileSync;
    renameSync: typeof renameSync;
    resolveRepo: (cwd: string) => GitChangeRepoIdentity | null;
    spawn: typeof spawn;
    statSync: typeof statSync;
    unlinkSync: typeof unlinkSync;
    writeFileSync: typeof writeFileSync;
}

const CACHE_SCHEMA_VERSION = 1 as const;
const DEFAULT_REFRESH_TIMEOUT_MS = 5_000;
const MAX_REFRESH_TIMEOUT_MS = 15_000;
const REFRESH_LOCK_STALE_MS = 30_000;
export const GIT_CHANGE_REFRESH_FLAG = '--internal-refresh-git-change-cache';

function getMtimeMs(filePath: string): number | null {
    try {
        return statSync(filePath).mtimeMs;
    } catch {
        return null;
    }
}

function normalizeDirectory(candidate: string): string | null {
    try {
        const resolved = path.resolve(candidate);
        const stats = statSync(resolved);
        return stats.isDirectory() ? resolved : path.dirname(resolved);
    } catch {
        return null;
    }
}

function readLinkedGitDir(gitFilePath: string): string | null {
    try {
        const content = readFileSync(gitFilePath, 'utf8').trim();
        const match = /^gitdir:\s*(.+)$/i.exec(content);
        return match?.[1]
            ? path.resolve(path.dirname(gitFilePath), match[1])
            : null;
    } catch {
        return null;
    }
}

function getCachePath(gitDir: string, home: string): string {
    const repoHash = createHash('sha256')
        .update(gitDir)
        .digest('hex')
        .slice(0, 16);
    return path.join(home, '.cache', 'ccstatusline', 'git-changes', `git-changes-${repoHash}.json`);
}

export function resolveGitChangeRepo(
    cwd: string,
    home: string = os.homedir()
): GitChangeRepoIdentity | null {
    const startDir = normalizeDirectory(cwd);
    if (!startDir) {
        return null;
    }

    let current = startDir;
    for (;;) {
        const gitPath = path.join(current, '.git');
        try {
            const stats = statSync(gitPath);
            const gitDir = stats.isDirectory()
                ? gitPath
                : stats.isFile()
                    ? readLinkedGitDir(gitPath)
                    : null;
            if (gitDir) {
                return {
                    root: current,
                    gitDir,
                    cachePath: getCachePath(gitDir, home),
                    headMtimeMs: getMtimeMs(path.join(gitDir, 'HEAD')),
                    indexMtimeMs: getMtimeMs(path.join(gitDir, 'index'))
                };
            }
        } catch {
            // Keep walking toward the filesystem root.
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function getDefaultSelfArgs(): string[] {
    const candidate = process.argv[1];
    if (!candidate || candidate.startsWith('-') || !existsSync(candidate)) {
        // A Bun-compiled executable re-enters directly through process.execPath.
        return [];
    }
    return [candidate];
}

const DEFAULT_DEPS: GitChangeCacheDeps = {
    closeSync,
    execFileSync,
    existsSync,
    getExecPath: () => process.execPath,
    getSelfArgs: getDefaultSelfArgs,
    mkdirSync,
    now: Date.now,
    openSync,
    readFileSync,
    renameSync,
    resolveRepo: cwd => resolveGitChangeRepo(cwd),
    spawn,
    statSync,
    unlinkSync,
    writeFileSync
};

function isStoredSnapshot(value: unknown): value is StoredGitChangeSnapshot {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<StoredGitChangeSnapshot>;
    return candidate.version === CACHE_SCHEMA_VERSION
        && typeof candidate.root === 'string'
        && typeof candidate.gitDir === 'string'
        && typeof candidate.refreshedAt === 'number'
        && (typeof candidate.headMtimeMs === 'number' || candidate.headMtimeMs === null)
        && (typeof candidate.indexMtimeMs === 'number' || candidate.indexMtimeMs === null)
        && typeof candidate.insertions === 'number'
        && Number.isSafeInteger(candidate.insertions)
        && candidate.insertions >= 0
        && typeof candidate.deletions === 'number'
        && Number.isSafeInteger(candidate.deletions)
        && candidate.deletions >= 0;
}

function readCache(
    identity: GitChangeRepoIdentity,
    ttlMs: number,
    deps: GitChangeCacheDeps
): CachedGitChangeSnapshot | 'miss' {
    try {
        const parsed = JSON.parse(deps.readFileSync(identity.cachePath, 'utf8')) as unknown;
        if (!isStoredSnapshot(parsed)
            || parsed.root !== identity.root
            || parsed.gitDir !== identity.gitDir) {
            return 'miss';
        }

        const metadataChanged = parsed.headMtimeMs !== identity.headMtimeMs
            || parsed.indexMtimeMs !== identity.indexMtimeMs;
        const ageExpired = ttlMs > 0 && deps.now() - parsed.refreshedAt > ttlMs;
        return {
            data: parsed,
            stale: metadataChanged || ageExpired
        };
    } catch {
        return 'miss';
    }
}

function writeCache(
    identity: GitChangeRepoIdentity,
    result: GitDiffResult,
    deps: GitChangeCacheDeps
): void {
    const cacheDir = path.dirname(identity.cachePath);
    const tempPath = `${identity.cachePath}.${process.pid}.${deps.now()}.tmp`;
    try {
        deps.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
        const stored: StoredGitChangeSnapshot = {
            version: CACHE_SCHEMA_VERSION,
            root: identity.root,
            gitDir: identity.gitDir,
            refreshedAt: deps.now(),
            headMtimeMs: identity.headMtimeMs,
            indexMtimeMs: identity.indexMtimeMs,
            insertions: result.insertions,
            deletions: result.deletions
        };
        deps.writeFileSync(tempPath, JSON.stringify(stored), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
        });
        deps.renameSync(tempPath, identity.cachePath);
    } catch {
        try {
            deps.unlinkSync(tempPath);
        } catch {
            // Best-effort cache cleanup.
        }
    }
}

function parseShortStat(output: string): GitDiffResult {
    const insertMatch = /(\d+)\s+insertions?/.exec(output);
    const deleteMatch = /(\d+)\s+deletions?/.exec(output);
    return {
        insertions: insertMatch?.[1] ? Number.parseInt(insertMatch[1], 10) : 0,
        deletions: deleteMatch?.[1] ? Number.parseInt(deleteMatch[1], 10) : 0
    };
}

function getRefreshTimeoutMs(): number {
    const configured = Number.parseInt(process.env.CCSTATUSLINE_GIT_SNAPSHOT_TIMEOUT_MS ?? '', 10);
    return Number.isInteger(configured) && configured > 0
        ? Math.min(configured, MAX_REFRESH_TIMEOUT_MS)
        : DEFAULT_REFRESH_TIMEOUT_MS;
}

function runDiff(
    args: string[],
    cwd: string,
    deadline: number,
    deps: GitChangeCacheDeps
): GitDiffResult | null {
    const timeout = Math.floor(deadline - deps.now());
    if (timeout <= 0) {
        return null;
    }

    try {
        const output = deps.execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                GIT_OPTIONAL_LOCKS: '0',
                LANG: 'C',
                LC_ALL: 'C'
            },
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout,
            windowsHide: true
        }).trim();
        return parseShortStat(output);
    } catch {
        return null;
    }
}

function fetchSnapshot(identity: GitChangeRepoIdentity, deps: GitChangeCacheDeps): GitDiffResult | null {
    const deadline = deps.now() + getRefreshTimeoutMs();
    const unstaged = runDiff(
        ['diff', '--no-ext-diff', '--shortstat'],
        identity.root,
        deadline,
        deps
    );
    if (!unstaged) {
        return null;
    }
    const staged = runDiff(
        ['diff', '--cached', '--no-ext-diff', '--shortstat'],
        identity.root,
        deadline,
        deps
    );
    if (!staged) {
        return null;
    }
    return {
        insertions: unstaged.insertions + staged.insertions,
        deletions: unstaged.deletions + staged.deletions
    };
}

function getRefreshLockPath(cachePath: string): string {
    return `${cachePath}.lock`;
}

function releaseRefreshLock(lockPath: string, deps: GitChangeCacheDeps): void {
    try {
        deps.unlinkSync(lockPath);
    } catch {
        // The lock may have been recovered by a later process.
    }
}

function createRefreshLock(cachePath: string, deps: GitChangeCacheDeps): string | null {
    try {
        deps.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    } catch {
        return null;
    }

    const lockPath = getRefreshLockPath(cachePath);
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const descriptor = deps.openSync(lockPath, 'wx', 0o600);
            deps.closeSync(descriptor);
            return lockPath;
        } catch {
            try {
                const age = deps.now() - deps.statSync(lockPath).mtimeMs;
                if (age <= REFRESH_LOCK_STALE_MS) {
                    return null;
                }
                deps.unlinkSync(lockPath);
            } catch {
                return null;
            }
        }
    }
    return null;
}

function scheduleRefresh(
    identity: GitChangeRepoIdentity,
    deps: GitChangeCacheDeps
): void {
    const lockPath = createRefreshLock(identity.cachePath, deps);
    if (!lockPath) {
        return;
    }

    try {
        const child = deps.spawn(
            deps.getExecPath(),
            [
                ...deps.getSelfArgs(),
                GIT_CHANGE_REFRESH_FLAG,
                identity.root,
                lockPath
            ],
            {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            }
        );
        child.unref();
    } catch {
        releaseRefreshLock(lockPath, deps);
    }
}

export function getCachedGitChangeCounts(
    cwd: string,
    ttlMs: number,
    deps: GitChangeCacheDeps = DEFAULT_DEPS
): GitChangeSnapshot | null {
    const identity = deps.resolveRepo(cwd);
    if (!identity) {
        return null;
    }

    const cached = readCache(identity, ttlMs, deps);
    if (cached === 'miss' || cached.stale) {
        scheduleRefresh(identity, deps);
    }
    if (cached === 'miss') {
        return null;
    }

    return {
        insertions: cached.data.insertions,
        deletions: cached.data.deletions,
        refreshedAt: cached.data.refreshedAt,
        stale: cached.stale
    };
}

export function refreshGitChangeCacheFromCli(
    cwd: string,
    lockPath: string,
    deps: GitChangeCacheDeps = DEFAULT_DEPS
): void {
    const identity = deps.resolveRepo(cwd);
    if (!identity || lockPath !== getRefreshLockPath(identity.cachePath)) {
        return;
    }

    try {
        const result = fetchSnapshot(identity, deps);
        if (!result) {
            return;
        }
        const refreshedIdentity = deps.resolveRepo(identity.root);
        if (refreshedIdentity?.gitDir === identity.gitDir
            && refreshedIdentity.headMtimeMs === identity.headMtimeMs
            && refreshedIdentity.indexMtimeMs === identity.indexMtimeMs) {
            writeCache(refreshedIdentity, result, deps);
        }
    } finally {
        releaseRefreshLock(lockPath, deps);
    }
}
