import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { RenderDeadline } from './render-deadline';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_LABEL_LENGTH = 80;
const LOCK_RETRY_MS = 15;

export interface ActivityAgent {
    id: string;
    type?: string;
    startedAt: string;
    lastEventAt: string;
}

export interface ActivityLedger {
    version: 1;
    agents: Record<string, ActivityAgent>;
    updatedAt: string;
}

export interface ActivityHookInput {
    hook_event_name?: string;
    session_id?: string;
    source?: string;
    agent_id?: string;
    agent_type?: string;
}

export interface SubagentTask {
    id?: string;
    type?: string;
    status?: string;
}

interface LedgerOptions {
    rootDir?: string;
    now?: () => Date;
    deadline?: RenderDeadline;
}

function getActivityRoot(rootDir?: string): string {
    return rootDir ?? path.join(os.homedir(), '.cache', 'ccstatusline', 'activity');
}

function normalizeIdentifier(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= MAX_IDENTIFIER_LENGTH
        ? normalized
        : null;
}

function sanitizeLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .trim()
        .slice(0, MAX_LABEL_LENGTH);
    return normalized.length > 0 ? normalized : undefined;
}

export function getSessionStorageKey(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex');
}

function resolveContainedPath(rootDir: string, fileName: string): string {
    const canonicalRoot = path.resolve(rootDir);
    const target = path.resolve(canonicalRoot, fileName);
    if (path.dirname(target) !== canonicalRoot) {
        throw new Error('Activity path escaped its root');
    }
    return target;
}

export function getActivityLedgerPath(sessionId: string, rootDir?: string): string {
    return resolveContainedPath(getActivityRoot(rootDir), `${getSessionStorageKey(sessionId)}.json`);
}

function getLockPath(sessionId: string, rootDir?: string): string {
    return resolveContainedPath(getActivityRoot(rootDir), `${getSessionStorageKey(sessionId)}.lock`);
}

function emptyLedger(now: Date): ActivityLedger {
    return {
        version: 1,
        agents: {},
        updatedAt: now.toISOString()
    };
}

function parseLedger(value: unknown): ActivityLedger | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<ActivityLedger>;
    if (candidate.version !== 1 || !candidate.agents || typeof candidate.agents !== 'object'
        || typeof candidate.updatedAt !== 'string') {
        return null;
    }

    const agents: Record<string, ActivityAgent> = {};
    for (const [key, agentValue] of Object.entries(candidate.agents as Record<string, unknown>)) {
        if (!agentValue || typeof agentValue !== 'object') {
            continue;
        }
        const agent = agentValue as Partial<ActivityAgent>;
        if (typeof agent.id !== 'string' || typeof agent.startedAt !== 'string'
            || typeof agent.lastEventAt !== 'string') {
            continue;
        }
        agents[key] = {
            id: agent.id,
            ...(typeof agent.type === 'string' ? { type: agent.type } : {}),
            startedAt: agent.startedAt,
            lastEventAt: agent.lastEventAt
        };
    }

    return {
        version: 1,
        agents,
        updatedAt: candidate.updatedAt
    };
}

export function readActivityLedger(sessionId: string, rootDir?: string): ActivityLedger | null {
    const normalizedSessionId = normalizeIdentifier(sessionId);
    if (!normalizedSessionId) {
        return null;
    }

    try {
        const raw = fs.readFileSync(getActivityLedgerPath(normalizedSessionId, rootDir), 'utf8');
        return parseLedger(JSON.parse(raw));
    } catch {
        return null;
    }
}

async function acquireLock(lockPath: string, deadline: RenderDeadline): Promise<fs.promises.FileHandle | null> {
    while (!deadline.expired()) {
        try {
            return await fs.promises.open(lockPath, 'wx', 0o600);
        } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
                return null;
            }
        }

        await new Promise(resolve => setTimeout(resolve, Math.min(LOCK_RETRY_MS, deadline.remainingMs())));
    }

    return null;
}

async function writeLedgerAtomic(ledgerPath: string, ledger: ActivityLedger): Promise<void> {
    const tempPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.promises.writeFile(tempPath, JSON.stringify(ledger), { encoding: 'utf8', mode: 0o600 });
        await fs.promises.rename(tempPath, ledgerPath);
    } catch (error) {
        await fs.promises.unlink(tempPath).catch(() => undefined);
        throw error;
    }
}

async function withLedgerLock(
    sessionId: string,
    options: LedgerOptions,
    update: (ledger: ActivityLedger, now: Date, ledgerPath: string) => Promise<void>
): Promise<boolean> {
    const rootDir = getActivityRoot(options.rootDir);
    const deadline = options.deadline ?? new RenderDeadline(1500);
    await fs.promises.mkdir(rootDir, { recursive: true, mode: 0o700 });

    const lockPath = getLockPath(sessionId, rootDir);
    const lock = await acquireLock(lockPath, deadline);
    if (!lock) {
        return false;
    }

    try {
        const now = options.now?.() ?? new Date();
        const ledgerPath = getActivityLedgerPath(sessionId, rootDir);
        const ledger = readActivityLedger(sessionId, rootDir) ?? emptyLedger(now);
        await update(ledger, now, ledgerPath);
        return true;
    } finally {
        await lock.close().catch(() => undefined);
        await fs.promises.unlink(lockPath).catch(() => undefined);
    }
}

export async function applyActivityHook(
    input: ActivityHookInput,
    options: LedgerOptions = {}
): Promise<boolean> {
    const sessionId = normalizeIdentifier(input.session_id);
    if (!sessionId) {
        return false;
    }

    const event = input.hook_event_name;
    if (event === 'SessionEnd') {
        return withLedgerLock(sessionId, options, async (_ledger, _now, ledgerPath) => {
            await fs.promises.unlink(ledgerPath).catch((error: unknown) => {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
                    throw error;
                }
            });
        });
    }

    if (event === 'SessionStart') {
        return withLedgerLock(sessionId, options, async (ledger, now, ledgerPath) => {
            const next = input.source === 'compact' ? ledger : emptyLedger(now);
            next.updatedAt = now.toISOString();
            await writeLedgerAtomic(ledgerPath, next);
        });
    }

    const agentId = normalizeIdentifier(input.agent_id);
    if (!agentId || (event !== 'SubagentStart' && event !== 'SubagentStop')) {
        return false;
    }

    return withLedgerLock(sessionId, options, async (ledger, now, ledgerPath) => {
        const agentKey = getSessionStorageKey(agentId);
        if (event === 'SubagentStart') {
            const timestamp = now.toISOString();
            const existing = ledger.agents[agentKey];
            ledger.agents[agentKey] = {
                id: agentKey,
                ...(sanitizeLabel(input.agent_type) ? { type: sanitizeLabel(input.agent_type) } : {}),
                startedAt: existing?.startedAt ?? timestamp,
                lastEventAt: timestamp
            };
        } else {
            const { [agentKey]: removedAgent, ...remainingAgents } = ledger.agents;
            void removedAgent;
            ledger.agents = remainingAgents;
        }
        ledger.updatedAt = now.toISOString();
        await writeLedgerAtomic(ledgerPath, ledger);
    });
}

function isActiveTask(task: SubagentTask): boolean {
    const status = task.status?.trim().toLowerCase();
    return status !== 'completed'
        && status !== 'failed'
        && status !== 'stopped'
        && status !== 'cancelled';
}

export async function reconcileActivityTasks(
    sessionIdValue: unknown,
    tasksValue: unknown,
    options: LedgerOptions = {}
): Promise<boolean> {
    const sessionId = normalizeIdentifier(sessionIdValue);
    if (!sessionId || !Array.isArray(tasksValue)) {
        return false;
    }

    return withLedgerLock(sessionId, options, async (_ledger, now, ledgerPath) => {
        const timestamp = now.toISOString();
        const agents: Record<string, ActivityAgent> = {};
        for (const taskValue of tasksValue) {
            if (!taskValue || typeof taskValue !== 'object') {
                continue;
            }
            const task = taskValue as SubagentTask;
            const taskId = normalizeIdentifier(task.id);
            if (!taskId || !isActiveTask(task)) {
                continue;
            }
            const taskKey = getSessionStorageKey(taskId);
            agents[taskKey] = {
                id: taskKey,
                ...(sanitizeLabel(task.type) ? { type: sanitizeLabel(task.type) } : {}),
                startedAt: timestamp,
                lastEventAt: timestamp
            };
        }

        await writeLedgerAtomic(ledgerPath, {
            version: 1,
            agents,
            updatedAt: timestamp
        });
    });
}
