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
    GitInsertionsWidget,
    formatGitInsertions
} from '../GitInsertions';

import {
    WIDGET_GIT_CWD,
    clearGitChangeSnapshot,
    primeGitChangeSnapshot
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
    const widget = new GitInsertionsWidget();
    const context: RenderContext = {
        isPreview: options.isPreview,
        data: options.cwd ? { cwd: options.cwd } : undefined
    };
    const item: WidgetItem = {
        id: 'git-insertions',
        type: 'git-insertions',
        metadata: options.hide ? { hide: options.hide } : (options.hideNoGit ? { hide: 'no-git' } : undefined)
    };

    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('GitInsertionsWidget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearGitCache(true);
        clearGitChangeSnapshot();
    });

    it('should render preview', () => {
        expect(render({ isPreview: true })).toBe('+42');
    });

    it('should render combined staged and unstaged insertions', () => {
        expect(formatGitInsertions({
            insertions: 5,
            deletions: 5,
            refreshedAt: 1000,
            stale: false
        })).toBe('+5');
    });

    it('should render zero count when repo is clean', () => {
        expect(formatGitInsertions({
            insertions: 0,
            deletions: 0,
            refreshedAt: 1000,
            stale: false
        })).toBe('+0');
    });

    it('should render unknown while the first snapshot refreshes', () => {
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: '/tmp/ccstatusline-missing-worktree' })).toBe('+?');
    });

    it('should mark a stale snapshot while it refreshes', () => {
        expect(formatGitInsertions({
            insertions: 8,
            deletions: 3,
            refreshedAt: 1000,
            stale: true
        })).toBe('+8~');
    });

    it('should hide zero insertions when the zero state is enabled', () => {
        primeGitChangeSnapshot(0, 0);
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: WIDGET_GIT_CWD, hide: 'zero' })).toBeNull();
    });

    it('should keep non-zero insertions visible with the zero state enabled', () => {
        primeGitChangeSnapshot(2, 1);
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: WIDGET_GIT_CWD, hide: 'zero' })).toBe('+2');
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
        const widget = new GitInsertionsWidget();

        expect(widget.supportsRawValue()).toBe(false);
    });
});
