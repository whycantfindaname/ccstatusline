import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
    ModelRegistryEntry,
    ProviderRegistryEntry,
    ResolvedContext,
    ResolvedEffort,
    ResolvedModel,
    ResolvedProvider,
    ResolvedSessionIdentity
} from '../types/SessionIdentity';
import type { StatusJSON } from '../types/StatusJSON';

import { readActivityLedger } from './activity-ledger';
import { getContextWindowMetrics } from './context-window';
import { RenderDeadline } from './render-deadline';
import {
    readTranscriptFacts,
    type TranscriptFacts
} from './transcript-tail';

const ENDPOINT_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL'] as const;
const MODEL_ENV_KEYS = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL'
] as const;
const EFFORT_ENV_KEYS = ['CLAUDE_CODE_EFFORT_LEVEL', 'ANTHROPIC_EFFORT'] as const;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

const DEFAULT_PROVIDER_REGISTRY: ProviderRegistryEntry[] = [
    { id: 'claude-official', displayName: 'Claude Official', origins: [] },
    { displayName: 'ClipProxyAPI', origins: ['http://localhost:8317', 'http://127.0.0.1:8317'] },
    { displayName: 'Claude duck relay', hostnames: ['api.duckcoding.ai'] },
    { displayName: 'Xiaomi MiMo', hostnames: ['token-plan-cn.xiaomimimo.com'] },
    { displayName: 'DeepSeek', hostnames: ['api.deepseek.com'] }
];

const DEFAULT_MODEL_REGISTRY: ModelRegistryEntry[] = [
    { pattern: '^gpt[- ]?5\\.6[- ]?sol(?:$|[ (\\[])', displayName: 'GPT 5.6 Sol' },
    { pattern: '^gpt[- ]?5\\.6[- ]?terra(?:$|[ (\\[])', displayName: 'GPT 5.6 Terra' },
    { pattern: 'deepseek', displayName: 'DeepSeek' },
    { pattern: 'mimo', displayName: 'MiMo' },
    {
        pattern: 'claude.*(?:opus|sonnet|haiku)',
        displayName: 'Claude',
        fullContextTokens: 200000,
        policyEvidence: 'https://code.claude.com/docs/en/model-config'
    }
];

export interface SessionIdentityOptions {
    env?: NodeJS.ProcessEnv;
    providerRegistry?: ProviderRegistryEntry[];
    modelRegistry?: ModelRegistryEntry[];
    activityRoot?: string;
    transcriptCacheDir?: string;
    deadline?: RenderDeadline;
}

function sanitizeDisplay(value: string, maxLength = 120): string {
    return value
        .replace(CONTROL_CHARACTERS, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function firstEnvironmentValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = env[key]?.trim();
        if (value) {
            return value;
        }
    }
    return undefined;
}

export function normalizeEndpointOrigin(value: string): { origin: string; hostname: string } | null {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return {
            origin: url.origin.toLowerCase(),
            hostname: url.hostname.toLowerCase()
        };
    } catch {
        return null;
    }
}

function resolveProvider(
    env: NodeJS.ProcessEnv,
    registry: ProviderRegistryEntry[]
): ResolvedProvider {
    const endpoint = firstEnvironmentValue(env, ENDPOINT_ENV_KEYS);
    if (!endpoint) {
        const official = registry.find(entry => entry.id === 'claude-official');
        return {
            ...(official?.id ? { id: official.id } : {}),
            displayName: sanitizeDisplay(official?.displayName ?? 'Claude Official'),
            source: 'official'
        };
    }

    const normalized = normalizeEndpointOrigin(endpoint);
    if (!normalized) {
        return {
            displayName: 'Custom endpoint',
            source: 'environment'
        };
    }

    const match = registry.find((entry) => {
        const originMatches = entry.origins?.some(
            origin => normalizeEndpointOrigin(origin)?.origin === normalized.origin
        ) ?? false;
        const hostnameMatches = entry.hostnames?.some(
            hostname => hostname.toLowerCase() === normalized.hostname
        ) ?? false;
        return originMatches ? true : hostnameMatches;
    });
    if (match) {
        return {
            ...(match.id ? { id: match.id } : {}),
            displayName: sanitizeDisplay(match.displayName),
            source: 'registry'
        };
    }

    return {
        displayName: sanitizeDisplay(normalized.hostname),
        source: 'hostname'
    };
}

function stdinModel(data: StatusJSON): { raw: string; display: string } | null {
    const model = data.model;
    if (typeof model === 'string') {
        const raw = sanitizeDisplay(model);
        return raw ? { raw, display: raw } : null;
    }
    const raw = sanitizeDisplay(model?.id ?? model?.display_name ?? '');
    const display = sanitizeDisplay(model?.display_name ?? model?.id ?? '');
    return raw && display ? { raw, display } : null;
}

function findModelRegistryEntry(
    rawModel: string,
    registry: ModelRegistryEntry[]
): ModelRegistryEntry | undefined {
    return registry.find((entry) => {
        try {
            return new RegExp(entry.pattern, 'i').test(rawModel);
        } catch {
            return false;
        }
    });
}

function stripModelMetadata(rawModel: string): string {
    return sanitizeDisplay(
        rawModel
            .replace(/\s*\((?:low|medium|high|xhigh|max)\)\s*$/i, '')
            .replace(/\s*\[\s*\d+(?:\.\d+)?\s*[km]\s*\]\s*$/i, '')
    );
}

function modelDisplayName(rawModel: string, fallback: string, registry: ModelRegistryEntry[]): string {
    const entry = findModelRegistryEntry(rawModel, registry);
    if (!entry) {
        return stripModelMetadata(fallback);
    }

    const contextSuffix = /\[\s*(\d+(?:\.\d+)?)\s*([km])\s*\]/i.exec(rawModel);
    const suffix = contextSuffix
        ? ` [${contextSuffix[1]}${contextSuffix[2]?.toUpperCase()}]`
        : '';
    return `${sanitizeDisplay(entry.displayName)}${suffix}`;
}

function resolveModel(
    data: StatusJSON,
    env: NodeJS.ProcessEnv,
    facts: TranscriptFacts,
    registry: ModelRegistryEntry[]
): ResolvedModel {
    const fromTranscript = facts.latestAssistantModel;
    if (fromTranscript) {
        return {
            raw: fromTranscript,
            displayName: modelDisplayName(fromTranscript, fromTranscript, registry),
            source: 'transcript'
        };
    }

    const fromStdin = stdinModel(data);
    if (fromStdin) {
        return {
            raw: fromStdin.raw,
            displayName: modelDisplayName(fromStdin.raw, fromStdin.display, registry),
            source: 'stdin'
        };
    }

    const fromEnvironment = firstEnvironmentValue(env, MODEL_ENV_KEYS);
    if (fromEnvironment) {
        const raw = sanitizeDisplay(fromEnvironment);
        return {
            raw,
            displayName: modelDisplayName(raw, raw, registry),
            source: 'environment'
        };
    }

    return {
        raw: 'Claude',
        displayName: 'Claude',
        source: 'alias'
    };
}

function normalizeEffort(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    return /^(?:low|medium|high|xhigh|max)$/.test(normalized) ? normalized : null;
}

function effortFromModel(rawModel: string): string | null {
    return normalizeEffort(
        /\((low|medium|high|xhigh|max)\)(?=\s*(?:\[\s*\d+(?:\.\d+)?\s*[km]\s*\]\s*)*$)/i
            .exec(rawModel)?.[1]
    );
}

function resolveEffort(data: StatusJSON, env: NodeJS.ProcessEnv, model: ResolvedModel): ResolvedEffort | undefined {
    const native = normalizeEffort(data.effort?.level);
    if (native) {
        return { level: native, source: 'stdin' };
    }
    const suffix = effortFromModel(model.raw);
    if (suffix) {
        return { level: suffix, source: 'model-suffix' };
    }
    const environment = normalizeEffort(firstEnvironmentValue(env, EFFORT_ENV_KEYS));
    return environment ? { level: environment, source: 'environment' } : undefined;
}

function positiveInteger(value: unknown): number | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function percentageInteger(value: unknown): number | undefined {
    const parsed = positiveInteger(value);
    return parsed && parsed <= 100 ? parsed : undefined;
}

function isRecognizedClaudeModel(rawModel: string): boolean {
    return /(?:claude|sonnet|opus|haiku)/i.test(rawModel);
}

function resolveContext(
    data: StatusJSON,
    env: NodeJS.ProcessEnv,
    model: ResolvedModel,
    registry: ModelRegistryEntry[]
): ResolvedContext {
    const metrics = getContextWindowMetrics(data);
    const registryEntry = findModelRegistryEntry(model.raw, registry);
    const hasPolicyEvidence = Boolean(registryEntry?.policyEvidence);
    const disableCompact = env.DISABLE_COMPACT === '1';
    const disableAutoCompact = env.DISABLE_AUTO_COMPACT === '1';
    const configuredMax = positiveInteger(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS);

    let fullLimit: number | undefined;
    let fullLimitSource: string | undefined;
    if (metrics.windowSize && metrics.windowSize > 0) {
        fullLimit = metrics.windowSize;
        fullLimitSource = 'stdin';
    } else if (configuredMax && (disableCompact || !isRecognizedClaudeModel(model.raw))) {
        fullLimit = configuredMax;
        fullLimitSource = 'environment';
    } else if (hasPolicyEvidence && registryEntry?.fullContextTokens) {
        fullLimit = registryEntry.fullContextTokens;
        fullLimitSource = 'model-registry';
    }

    if (disableCompact) {
        return {
            ...(metrics.contextLengthTokens !== null ? { usedTokens: metrics.contextLengthTokens } : {}),
            ...(fullLimit ? { fullLimit, fullLimitSource } : {}),
            compactionState: 'disabled'
        };
    }

    const configuredBasis = positiveInteger(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
    const registryBasis = hasPolicyEvidence
        ? registryEntry?.defaultAutoCompactBasisTokens
        : undefined;
    const rawBasis = configuredBasis ?? registryBasis;
    const basis = rawBasis && fullLimit ? Math.min(rawBasis, fullLimit) : rawBasis;
    const basisSource = configuredBasis
        ? 'environment'
        : registryBasis
            ? 'model-registry'
            : undefined;

    const percentage = percentageInteger(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
    const percentageThreshold = basis && percentage
        ? Math.floor(basis * percentage / 100)
        : undefined;
    const defaultThreshold = hasPolicyEvidence
        ? registryEntry?.defaultAutoCompactThresholdTokens
        : undefined;
    const threshold = disableAutoCompact
        ? undefined
        : defaultThreshold && percentageThreshold
            ? Math.min(defaultThreshold, percentageThreshold)
            : percentageThreshold ?? defaultThreshold;
    const thresholdSource = threshold === undefined
        ? undefined
        : percentageThreshold !== undefined
            ? 'environment-percentage'
            : 'model-registry';

    return {
        ...(metrics.contextLengthTokens !== null ? { usedTokens: metrics.contextLengthTokens } : {}),
        ...(fullLimit ? { fullLimit, fullLimitSource } : {}),
        ...(basis ? { autoCompactBasis: basis, basisSource } : {}),
        ...(threshold ? { autoCompactThreshold: threshold, thresholdSource } : {}),
        compactionState: disableAutoCompact ? 'auto-disabled' : 'enabled'
    };
}

function loadRegistryFile<T>(
    filePath: string | undefined,
    property: 'providers' | 'models',
    fallback: T[]
): T[] {
    if (!filePath) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        return Array.isArray(parsed[property]) ? parsed[property] as T[] : fallback;
    } catch {
        return fallback;
    }
}

function registryPath(env: NodeJS.ProcessEnv, fileName: string): string | undefined {
    const configDir = env.CCSTATUSLINE_CONFIG_DIR;
    return configDir ? path.join(configDir, fileName) : undefined;
}

export async function resolveSessionIdentity(
    data: StatusJSON,
    options: SessionIdentityOptions = {}
): Promise<ResolvedSessionIdentity> {
    const env = options.env ?? process.env;
    const deadline = options.deadline ?? new RenderDeadline();
    const providerRegistry = options.providerRegistry
        ?? loadRegistryFile<ProviderRegistryEntry>(
            registryPath(env, 'providers.json'),
            'providers',
            DEFAULT_PROVIDER_REGISTRY
        );
    const modelRegistry = options.modelRegistry
        ?? loadRegistryFile<ModelRegistryEntry>(
            registryPath(env, 'models.json'),
            'models',
            DEFAULT_MODEL_REGISTRY
        );
    const facts = await readTranscriptFacts(data.transcript_path, {
        cacheDir: options.transcriptCacheDir,
        deadline
    });
    const model = resolveModel(data, env, facts, modelRegistry);
    const effort = resolveEffort(data, env, model);
    const ledger = data.session_id
        ? readActivityLedger(data.session_id, options.activityRoot)
        : null;

    return {
        provider: resolveProvider(env, providerRegistry),
        model,
        ...(effort ? { effort } : {}),
        context: resolveContext(data, env, model, modelRegistry),
        activity: {
            ...(ledger ? { activeAgents: Object.keys(ledger.agents).length } : {}),
            ...(facts.toolsLastTurn !== undefined ? { toolsLastTurn: facts.toolsLastTurn } : {}),
            ...(facts.cacheTimestamp ? { cacheTimestamp: facts.cacheTimestamp } : {}),
            ...(facts.sessionStartedAt ? { sessionStartedAt: facts.sessionStartedAt } : {}),
            ...(facts.sessionUpdatedAt ? { sessionUpdatedAt: facts.sessionUpdatedAt } : {})
        }
    };
}
