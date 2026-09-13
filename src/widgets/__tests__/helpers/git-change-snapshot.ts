import { createHash } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveGitChangeRepo } from '../../../utils/git-change-cache';

export const WIDGET_GIT_CWD = '/tmp/ccstatusline-missing-worktree';

export function clearGitChangeSnapshot(cwd: string = WIDGET_GIT_CWD): void {
    const identity = resolveGitChangeRepo(cwd);
    if (!identity) {
        return;
    }

    const gitCacheHash = createHash('sha256')
        .update(identity.gitDir)
        .digest('hex')
        .slice(0, 16);
    const gitCommandCachePath = path.join(
        os.homedir(),
        '.cache',
        'ccstatusline',
        'git-cache',
        `git-${gitCacheHash}.json`
    );
    for (const filePath of [
        identity.cachePath,
        `${identity.cachePath}.lock`,
        gitCommandCachePath
    ]) {
        try {
            unlinkSync(filePath);
        } catch {
            // Test cleanup is best effort.
        }
    }
}

export function primeGitChangeSnapshot(
    insertions: number,
    deletions: number,
    cwd: string = WIDGET_GIT_CWD
): void {
    const identity = resolveGitChangeRepo(cwd);
    if (!identity) {
        throw new Error(`Git fixture is missing: ${cwd}`);
    }

    mkdirSync(path.dirname(identity.cachePath), { recursive: true });
    writeFileSync(identity.cachePath, JSON.stringify({
        version: 1,
        root: identity.root,
        gitDir: identity.gitDir,
        refreshedAt: Date.now(),
        headMtimeMs: identity.headMtimeMs,
        indexMtimeMs: identity.indexMtimeMs,
        insertions,
        deletions
    }), 'utf8');
}
