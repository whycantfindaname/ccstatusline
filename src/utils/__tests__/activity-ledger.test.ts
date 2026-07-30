import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    applyActivityHook,
    getActivityLedgerPath,
    getSessionStorageKey,
    readActivityLedger,
    reconcileActivityTasks
} from '../activity-ledger';

describe('activity ledger', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-activity-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('hashes traversal-shaped session IDs into a contained filename', () => {
        const sessionId = '../../../../.claude';
        const ledgerPath = getActivityLedgerPath(sessionId, root);

        expect(path.dirname(ledgerPath)).toBe(path.resolve(root));
        expect(path.basename(ledgerPath)).toBe(`${getSessionStorageKey(sessionId)}.json`);
        expect(ledgerPath).not.toContain('..');
    });

    it('tracks duplicate starts, stops, resets, and cleanup idempotently', async () => {
        const sessionId = 'session-1';
        await applyActivityHook({
            hook_event_name: 'SessionStart',
            session_id: sessionId,
            source: 'startup'
        }, { rootDir: root });
        await Promise.all([
            applyActivityHook({
                hook_event_name: 'SubagentStart',
                session_id: sessionId,
                agent_id: 'agent-1',
                agent_type: 'Explore'
            }, { rootDir: root }),
            applyActivityHook({
                hook_event_name: 'SubagentStart',
                session_id: sessionId,
                agent_id: 'agent-2',
                agent_type: 'Review'
            }, { rootDir: root })
        ]);

        expect(Object.keys(readActivityLedger(sessionId, root)?.agents ?? {})).toHaveLength(2);

        await applyActivityHook({
            hook_event_name: 'SubagentStop',
            session_id: sessionId,
            agent_id: 'agent-1'
        }, { rootDir: root });
        expect(Object.keys(readActivityLedger(sessionId, root)?.agents ?? {})).toHaveLength(1);

        await applyActivityHook({
            hook_event_name: 'SessionEnd',
            session_id: sessionId
        }, { rootDir: root });
        expect(readActivityLedger(sessionId, root)).toBeNull();
    });

    it('reconciles the parent ledger from active task snapshots', async () => {
        const sessionId = 'session-2';
        await reconcileActivityTasks(sessionId, [
            { id: 'active', status: 'running', type: 'Explore' },
            { id: 'done', status: 'completed', type: 'Review' }
        ], { rootDir: root });

        expect(Object.keys(readActivityLedger(sessionId, root)?.agents ?? {})).toHaveLength(1);

        await reconcileActivityTasks(sessionId, [], { rootDir: root });
        expect(Object.keys(readActivityLedger(sessionId, root)?.agents ?? {})).toHaveLength(0);
    });
});
