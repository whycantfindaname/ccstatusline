import { execFileSync } from 'child_process';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { clearGitCache } from '../../utils/git';
import {
    GitDeletionsWidget,
    formatGitDeletions
} from '../GitDeletions';
import {
    clearGitChangeSnapshot,
    primeGitChangeSnapshot,
    WIDGET_GIT_CWD
} from './helpers/git-change-snapshot';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    execFileSync: vi.fn(),
    spawn: vi.fn(),
    spawnSync: vi.fn()
}));

const mockExecFileSync = execFileSync as unknown as {
    mockImplementation: (impl: () => never) => void;
    mockReturnValue: (value: string) => void;
    mockReturnValueOnce: (value: string) => void;
};

function render(options: {
    cwd?: string;
    hide?: string;
    hideNoGit?: boolean;
    isPreview?: boolean;
} = {}) {
    const widget = new GitDeletionsWidget();
    const context: RenderContext = {
        isPreview: options.isPreview,
        data: options.cwd ? { cwd: options.cwd } : undefined
    };
    const item: WidgetItem = {
        id: 'git-deletions',
        type: 'git-deletions',
        metadata: options.hide ? { hide: options.hide } : (options.hideNoGit ? { hide: 'no-git' } : undefined)
    };

    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('GitDeletionsWidget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearGitCache(true);
        clearGitChangeSnapshot();
    });

    it('should render preview', () => {
        expect(render({ isPreview: true })).toBe('-10');
    });

    it('should render combined staged and unstaged deletions', () => {
        expect(formatGitDeletions({
            insertions: 5,
            deletions: 5,
            refreshedAt: 1000,
            stale: false
        })).toBe('-5');
    });

    it('should render zero count when repo is clean', () => {
        expect(formatGitDeletions({
            insertions: 0,
            deletions: 0,
            refreshedAt: 1000,
            stale: false
        })).toBe('-0');
    });

    it('should render unknown while the first snapshot refreshes', () => {
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: '/tmp/ccstatusline-missing-worktree' })).toBe('-?');
    });

    it('should mark a stale snapshot while it refreshes', () => {
        expect(formatGitDeletions({
            insertions: 8,
            deletions: 3,
            refreshedAt: 1000,
            stale: true
        })).toBe('-3~');
    });

    it('should hide zero deletions when the zero state is enabled', () => {
        primeGitChangeSnapshot(0, 0);
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: WIDGET_GIT_CWD, hide: 'zero' })).toBeNull();
    });

    it('should keep non-zero deletions visible with the zero state enabled', () => {
        primeGitChangeSnapshot(2, 1);
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: WIDGET_GIT_CWD, hide: 'zero' })).toBe('-1');
    });

    it('should render no git when probe returns false', () => {
        mockExecFileSync.mockReturnValue('false\n');

        expect(render({ cwd: '/tmp/ccstatusline-no-git' })).toBe('(no git)');
    });

    it('should hide no git when configured', () => {
        mockExecFileSync.mockReturnValue('false\n');

        expect(render({ cwd: '/tmp/ccstatusline-no-git', hideNoGit: true })).toBeNull();
    });

    it('should render no git when command fails', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('No git'); });

        expect(render({ cwd: '/tmp/ccstatusline-no-git' })).toBe('(no git)');
    });

    it('should disable raw value support', () => {
        const widget = new GitDeletionsWidget();

        expect(widget.supportsRawValue()).toBe(false);
    });
});
