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
    GitChangesWidget,
    formatGitChanges
} from '../GitChanges';

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
    hideNoGit?: boolean;
    isPreview?: boolean;
} = {}) {
    const widget = new GitChangesWidget();
    const context: RenderContext = {
        isPreview: options.isPreview,
        data: options.cwd ? { cwd: options.cwd } : undefined
    };
    const item: WidgetItem = {
        id: 'git-changes',
        type: 'git-changes',
        metadata: options.hideNoGit ? { hideNoGit: 'true' } : undefined
    };

    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('GitChangesWidget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearGitCache();
    });

    it('should render preview', () => {
        expect(render({ isPreview: true })).toBe('(+42,-10)');
    });

    it('should render combined staged and unstaged changes', () => {
        expect(formatGitChanges({
            insertions: 5,
            deletions: 5,
            refreshedAt: 1000,
            stale: false
        })).toBe('(+5,-5)');
    });

    it('should render zero counts when repo is clean', () => {
        expect(formatGitChanges({
            insertions: 0,
            deletions: 0,
            refreshedAt: 1000,
            stale: false
        })).toBe('(+0,-0)');
    });

    it('should render unknown counts while the first snapshot refreshes', () => {
        mockExecFileSync.mockReturnValueOnce('true\n');

        expect(render({ cwd: '/tmp/ccstatusline-missing-worktree' })).toBe('(+?,-?)');
    });

    it('should mark a stale snapshot while it refreshes', () => {
        expect(formatGitChanges({
            insertions: 12,
            deletions: 3,
            refreshedAt: 1000,
            stale: true
        })).toBe('(+12,-3)~');
    });

    it('should render no git when probe returns false', () => {
        mockExecFileSync.mockReturnValue('false\n');

        expect(render()).toBe('(no git)');
    });

    it('should hide no git when configured', () => {
        mockExecFileSync.mockReturnValue('false\n');

        expect(render({ hideNoGit: true })).toBeNull();
    });

    it('should render no git when command fails', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('No git'); });

        expect(render()).toBe('(no git)');
    });
});
