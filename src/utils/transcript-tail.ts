import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { RenderDeadline } from './render-deadline';

const INITIAL_WINDOW_BYTES = 256 * 1024;
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_SCAN_BYTES = 32 * 1024 * 1024;
export const COLD_READ_BUDGET_MS = 100;

export interface TranscriptFacts {
    latestAssistantModel?: string;
    cacheTimestamp?: string;
    toolsLastTurn?: number;
    sessionStartedAt?: string;
    sessionUpdatedAt?: string;
}

interface TranscriptCache {
    version: 1;
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    facts: TranscriptFacts;
}

interface ReadOptions {
    cacheDir?: string;
    deadline?: RenderDeadline;
}

interface TranscriptRecord {
    type?: string;
    timestamp?: string;
    isMeta?: boolean;
    isSidechain?: boolean;
    origin?: {
        kind?: string;
        source?: string;
    };
    toolUseResult?: unknown;
    sourceToolAssistantUUID?: unknown;
    message?: {
        role?: string;
        model?: string;
        content?: unknown;
        usage?: {
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        };
    };
}

function cacheKey(transcriptPath: string): string {
    return createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
}

function getCachePath(transcriptPath: string, cacheDir?: string): string {
    const root = cacheDir ?? path.join(os.homedir(), '.cache', 'ccstatusline', 'transcripts');
    return path.join(root, `${cacheKey(transcriptPath)}.json`);
}

function readCache(transcriptPath: string, cacheDir?: string): TranscriptCache | null {
    try {
        const parsed = JSON.parse(fs.readFileSync(getCachePath(transcriptPath, cacheDir), 'utf8')) as Partial<TranscriptCache>;
        if (parsed.version !== 1 || typeof parsed.dev !== 'number' || typeof parsed.ino !== 'number'
            || typeof parsed.size !== 'number' || typeof parsed.mtimeMs !== 'number'
            || !parsed.facts || typeof parsed.facts !== 'object') {
            return null;
        }
        return parsed as TranscriptCache;
    } catch {
        return null;
    }
}

async function writeCache(
    transcriptPath: string,
    stat: fs.Stats,
    facts: TranscriptFacts,
    cacheDir?: string
): Promise<void> {
    const cachePath = getCachePath(transcriptPath, cacheDir);
    const cacheRoot = path.dirname(cachePath);
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.promises.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
        const value: TranscriptCache = {
            version: 1,
            dev: stat.dev,
            ino: stat.ino,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            facts
        };
        await fs.promises.writeFile(tempPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
        await fs.promises.rename(tempPath, cachePath);
    } catch {
        await fs.promises.unlink(tempPath).catch(() => undefined);
    }
}

function sameFile(cache: TranscriptCache, stat: fs.Stats): boolean {
    return cache.dev === stat.dev && cache.ino === stat.ino;
}

function unchanged(cache: TranscriptCache, stat: fs.Stats): boolean {
    return sameFile(cache, stat)
        && cache.size === stat.size
        && cache.mtimeMs === stat.mtimeMs;
}

function parseRecord(line: string): TranscriptRecord | null {
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
        return null;
    }
    try {
        const parsed = JSON.parse(line) as unknown;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function isAssistant(record: TranscriptRecord): boolean {
    return record.type === 'assistant' || record.message?.role === 'assistant';
}

function normalizeModel(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const model = value.trim();
    return model.length > 0 && model !== '<synthetic>' ? model : null;
}

function cacheTokens(record: TranscriptRecord): number {
    const usage = record.message?.usage;
    const creation = typeof usage?.cache_creation_input_tokens === 'number'
        ? Math.max(0, usage.cache_creation_input_tokens)
        : 0;
    const read = typeof usage?.cache_read_input_tokens === 'number'
        ? Math.max(0, usage.cache_read_input_tokens)
        : 0;
    return creation + read;
}

function getContentBlocks(content: unknown): unknown[] {
    return Array.isArray(content) ? Array.from(content) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function countToolUseBlocks(record: TranscriptRecord): number {
    if (!isAssistant(record)) {
        return 0;
    }
    return getContentBlocks(record.message?.content).filter((block) => {
        return Boolean(block && typeof block === 'object' && 'type' in block && block.type === 'tool_use');
    }).length;
}

function hasNonemptyUserContent(content: unknown): boolean {
    if (typeof content === 'string') {
        return content.trim().length > 0;
    }
    if (!Array.isArray(content)) {
        return false;
    }
    return content.some((block) => {
        if (typeof block === 'string') {
            return block.trim().length > 0;
        }
        const record = asRecord(block);
        if (!record) {
            return false;
        }
        if (record.type === 'tool_result') {
            return false;
        }
        if (typeof record.text === 'string') {
            return record.text.trim().length > 0;
        }
        return true;
    });
}

function isToolResultOnly(content: unknown): boolean {
    if (!Array.isArray(content) || content.length === 0) {
        return false;
    }
    return content.every((block) => {
        return asRecord(block)?.type === 'tool_result';
    });
}

function isHumanPrompt(record: TranscriptRecord): boolean {
    if (record.type !== 'user' || record.message?.role !== 'user'
        || record.toolUseResult !== undefined || record.sourceToolAssistantUUID !== undefined
        || record.isMeta === true || record.origin?.kind === 'task-notification'
        || isToolResultOnly(record.message.content) || !hasNonemptyUserContent(record.message.content)) {
        return false;
    }

    const kind = record.origin?.kind;
    const source = record.origin?.source;
    return kind === 'human'
        || source === 'typed'
        || source === 'queued'
        || source === 'sdk'
        || (kind === undefined && source === undefined);
}

function validTimestamp(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? value : null;
}

function scanLines(lines: string[]): TranscriptFacts {
    const facts: TranscriptFacts = {};
    let tools = 0;
    let foundHumanBoundary = false;

    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index];
        if (!line) {
            continue;
        }
        const record = parseRecord(line);
        if (!record || record.isSidechain === true) {
            continue;
        }

        const timestamp = validTimestamp(record.timestamp);
        if (!facts.sessionUpdatedAt && timestamp) {
            facts.sessionUpdatedAt = timestamp;
        }
        if (!facts.latestAssistantModel && isAssistant(record)) {
            const model = normalizeModel(record.message?.model);
            if (model) {
                facts.latestAssistantModel = model;
            }
        }
        if (!facts.cacheTimestamp && isAssistant(record) && cacheTokens(record) > 0 && timestamp) {
            facts.cacheTimestamp = timestamp;
        }

        if (!foundHumanBoundary) {
            if (isHumanPrompt(record)) {
                foundHumanBoundary = true;
                facts.toolsLastTurn = tools;
            } else {
                tools += countToolUseBlocks(record);
            }
        }

        if (facts.latestAssistantModel && facts.cacheTimestamp && foundHumanBoundary && facts.sessionUpdatedAt) {
            break;
        }
    }

    return facts;
}

function completeLines(buffer: Buffer, startOffset: number): string[] {
    let content = buffer.toString('utf8');
    if (startOffset > 0) {
        const firstDelimiter = content.indexOf('\n');
        if (firstDelimiter < 0) {
            return [];
        }
        content = content.slice(firstDelimiter + 1);
    }
    return content.split('\n').filter(line => line.length > 0);
}

async function readWindow(
    handle: fs.promises.FileHandle,
    fileSize: number,
    windowBytes: number
): Promise<{ buffer: Buffer; startOffset: number }> {
    const bytesToRead = Math.min(fileSize, windowBytes);
    const startOffset = fileSize - bytesToRead;
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, startOffset);
    return {
        buffer: result.bytesRead === buffer.length ? buffer : buffer.subarray(0, result.bytesRead),
        startOffset
    };
}

async function readFirstTimestamp(
    handle: fs.promises.FileHandle,
    fileSize: number,
    deadline: RenderDeadline
): Promise<string | undefined> {
    if (fileSize <= 0 || deadline.expired()) {
        return undefined;
    }
    let windowBytes = INITIAL_WINDOW_BYTES;
    while (!deadline.expired() && windowBytes <= MAX_RECORD_BYTES) {
        const bytesToRead = Math.min(fileSize, windowBytes);
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const result = await handle.read(buffer, 0, bytesToRead, 0);
        const content = buffer.subarray(0, result.bytesRead).toString('utf8');
        const completeContent = bytesToRead === fileSize
            ? content
            : content.slice(0, Math.max(0, content.lastIndexOf('\n')));
        for (const line of completeContent.split('\n')) {
            const record = parseRecord(line);
            const timestamp = validTimestamp(record?.timestamp);
            if (timestamp) {
                return timestamp;
            }
        }
        if (bytesToRead === fileSize) {
            break;
        }
        windowBytes *= 2;
    }
    return undefined;
}

function mergeCachedFacts(facts: TranscriptFacts, cache: TranscriptCache | null, stat: fs.Stats): TranscriptFacts {
    if (!cache || !sameFile(cache, stat) || stat.size < cache.size) {
        return facts;
    }
    return {
        latestAssistantModel: facts.latestAssistantModel ?? cache.facts.latestAssistantModel,
        cacheTimestamp: facts.cacheTimestamp ?? cache.facts.cacheTimestamp,
        toolsLastTurn: facts.toolsLastTurn ?? cache.facts.toolsLastTurn,
        sessionStartedAt: facts.sessionStartedAt ?? cache.facts.sessionStartedAt,
        sessionUpdatedAt: facts.sessionUpdatedAt ?? cache.facts.sessionUpdatedAt
    };
}

export async function readTranscriptFacts(
    transcriptPath: string | undefined,
    options: ReadOptions = {}
): Promise<TranscriptFacts> {
    if (!transcriptPath) {
        return {};
    }

    const parentDeadline = options.deadline ?? new RenderDeadline(COLD_READ_BUDGET_MS);
    const localBudget = Math.min(COLD_READ_BUDGET_MS, parentDeadline.remainingMs());
    const startedAt = performance.now();
    const localDeadline = new RenderDeadline(localBudget, () => performance.now());
    const cache = readCache(transcriptPath, options.cacheDir);

    let handle: fs.promises.FileHandle | null = null;
    let currentStat: fs.Stats | null = null;
    try {
        const stat = await fs.promises.stat(transcriptPath);
        currentStat = stat;
        if (!stat.isFile()) {
            return {};
        }
        if (cache && unchanged(cache, stat)) {
            return cache.facts;
        }

        handle = await fs.promises.open(transcriptPath, 'r');
        let windowBytes = INITIAL_WINDOW_BYTES;
        let facts: TranscriptFacts = {};

        while (!localDeadline.expired() && windowBytes <= MAX_SCAN_BYTES) {
            const window = await readWindow(handle, stat.size, windowBytes);
            facts = scanLines(completeLines(window.buffer, window.startOffset));
            const hasRequestedFacts = Boolean(facts.latestAssistantModel)
                && facts.toolsLastTurn !== undefined;
            if (hasRequestedFacts || window.startOffset === 0) {
                break;
            }
            windowBytes *= 2;
        }

        if (!localDeadline.expired()) {
            facts.sessionStartedAt = await readFirstTimestamp(handle, stat.size, localDeadline);
        }
        facts = mergeCachedFacts(facts, cache, stat);

        if (performance.now() - startedAt <= COLD_READ_BUDGET_MS + 25) {
            await writeCache(transcriptPath, stat, facts, options.cacheDir);
        }
        return facts;
    } catch {
        return cache && currentStat && sameFile(cache, currentStat)
            ? cache.facts
            : {};
    } finally {
        await handle?.close().catch(() => undefined);
    }
}
