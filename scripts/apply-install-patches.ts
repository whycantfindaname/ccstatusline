#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');

function gitApply(
    inkRoot: string,
    patchPath: string,
    arguments_: string[]
): ReturnType<typeof spawnSync> {
    return spawnSync(
        'git',
        ['apply', ...arguments_, patchPath],
        {
            cwd: inkRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );
}

function diagnostic(result: ReturnType<typeof spawnSync>): string {
    return [result.error?.message, result.stderr, result.stdout]
        .filter(Boolean)
        .join('\n')
        .trim();
}

export function applyInstallPatches(
    repositoryRoot = REPOSITORY_ROOT,
    patchPath = path.join(repositoryRoot, 'patches', 'ink@6.2.0.patch')
): 'applied' | 'present' {
    const inkRoot = fs.realpathSync(path.join(repositoryRoot, 'node_modules', 'ink'));
    const target = path.join(inkRoot, 'build', 'parse-keypress.js');
    if (!fs.statSync(target).isFile()) {
        throw new Error(`Ink patch target is not a regular file: ${target}`);
    }

    const forward = gitApply(inkRoot, patchPath, ['--check']);
    if (forward.status === 0) {
        const applied = gitApply(inkRoot, patchPath, []);
        if (applied.status !== 0) {
            throw new Error(`Ink patch apply failed: ${diagnostic(applied)}`);
        }
        const verified = gitApply(inkRoot, patchPath, ['--reverse', '--check']);
        if (verified.status !== 0) {
            throw new Error(`Ink patch verification failed: ${diagnostic(verified)}`);
        }
        return 'applied';
    }

    const reverse = gitApply(inkRoot, patchPath, ['--reverse', '--check']);
    if (reverse.status === 0) {
        return 'present';
    }
    throw new Error(
        'Ink patch target matches neither the expected source nor patched state: '
        + diagnostic(forward)
    );
}

if (import.meta.main) {
    try {
        console.log(`ink_patch=${applyInstallPatches()}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`apply-install-patches: ${message}`);
        process.exitCode = 1;
    }
}
