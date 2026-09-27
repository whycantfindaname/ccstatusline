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

const INK_DELETE_BLOCK = [
    '    else if (s === \'\\x7f\' || s === \'\\x1b\\x7f\') {',
    '        // TODO(vadimdemedes): `enquirer` detects delete key as backspace, but I had to split them up to avoid breaking changes in Ink. Merge them back together in the next major version.',
    '        // delete',
    '        key.name = \'delete\';',
    '        key.meta = s.charAt(0) === \'\\x1b\';',
    '    }'
].join('\n');

const INK_BACKSPACE_BLOCK = [
    '    else if (s === \'\\x7f\' || s === \'\\x1b\\x7f\') {',
    '        // On macOS, \\x7f is what the backspace key sends, not delete',
    '        // The actual forward delete sends escape sequences like \\x1b[3~',
    '        key.name = \'backspace\';',
    '        key.meta = s.charAt(0) === \'\\x1b\';',
    '    }'
].join('\n');

function replaceInkBackspaceBlock(target: string): boolean {
    const source = fs.readFileSync(target, 'utf8');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const normalized = source.replace(/\r\n/g, '\n');
    if (!normalized.includes(INK_DELETE_BLOCK)) {
        return false;
    }

    const replaced = normalized.replace(INK_DELETE_BLOCK, INK_BACKSPACE_BLOCK);
    fs.writeFileSync(target, replaced.replace(/\n/g, newline), 'utf8');
    return true;
}

function hasInkBackspaceBlock(target: string): boolean {
    const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    return source.includes(INK_BACKSPACE_BLOCK);
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

    // The patch carries the line number from the published Ink build. Git's
    // patch matcher refuses that hunk for the intentionally short fixtures
    // used by tests (and for package managers that rewrite source maps). Keep
    // the normal patch path first, then replace only the exact upstream block
    // as a bounded compatibility fallback.
    if (replaceInkBackspaceBlock(target)) {
        if (!hasInkBackspaceBlock(target)) {
            throw new Error(`Ink patch fallback verification failed: ${target}`);
        }
        return 'applied';
    }

    const reverse = gitApply(inkRoot, patchPath, ['--reverse', '--check']);
    if (reverse.status === 0 || hasInkBackspaceBlock(target)) {
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
