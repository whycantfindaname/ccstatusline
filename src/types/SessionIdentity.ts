export type ProviderSource = 'environment' | 'registry' | 'hostname' | 'official';
export type ModelSource = 'transcript' | 'stdin' | 'environment' | 'alias';
export type EffortSource = 'stdin' | 'model-suffix' | 'environment';

export interface ResolvedProvider {
    id?: string;
    displayName: string;
    source: ProviderSource;
}

export interface ResolvedModel {
    raw: string;
    displayName: string;
    source: ModelSource;
}

export interface ResolvedEffort {
    level: string;
    source: EffortSource;
}

export interface ResolvedContext {
    usedTokens?: number;
    fullLimit?: number;
    autoCompactBasis?: number;
    autoCompactThreshold?: number;
    compactionState?: 'enabled' | 'auto-disabled' | 'disabled';
    fullLimitSource?: string;
    basisSource?: string;
    thresholdSource?: string;
}

export interface ResolvedActivity {
    activeAgents?: number;
    toolsLastTurn?: number;
    cacheTimestamp?: string;
    sessionStartedAt?: string;
    sessionUpdatedAt?: string;
}

export interface ResolvedSessionIdentity {
    provider: ResolvedProvider;
    model: ResolvedModel;
    effort?: ResolvedEffort;
    context: ResolvedContext;
    activity: ResolvedActivity;
}

export interface ProviderRegistryEntry {
    id?: string;
    displayName: string;
    origins?: string[];
    hostnames?: string[];
}

export interface ModelRegistryEntry {
    pattern: string;
    displayName: string;
    fullContextTokens?: number;
    defaultAutoCompactBasisTokens?: number;
    defaultAutoCompactThresholdTokens?: number;
    policyEvidence?: string;
}
