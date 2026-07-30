import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import type {
    ModelRegistryEntry,
    ProviderRegistryEntry
} from '../../types/SessionIdentity';
import type { StatusJSON } from '../../types/StatusJSON';
import { resolveSessionIdentity } from '../session-identity';

const PROVIDERS: ProviderRegistryEntry[] = [
    { id: 'claude-official', displayName: 'Claude Official', origins: [] },
    { displayName: 'ClipProxyAPI', origins: ['http://localhost:8317'] },
    { displayName: 'DeepSeek', hostnames: ['api.deepseek.com'] }
];

const MODELS: ModelRegistryEntry[] = [
    { pattern: 'gpt-5\\.6-sol', displayName: 'GPT 5.6 Sol' },
    {
        pattern: 'deepseek',
        displayName: 'DeepSeek',
        fullContextTokens: 1000000,
        defaultAutoCompactBasisTokens: 64000,
        defaultAutoCompactThresholdTokens: 52000,
        policyEvidence: 'fixture'
    }
];

describe('session identity resolver', () => {
    afterEach(() => {
        delete process.env.ANTHROPIC_BASE_URL;
    });

    it('recomputes provider identity from each supplied environment', async () => {
        const clip = await resolveSessionIdentity({}, {
            env: { ANTHROPIC_BASE_URL: 'http://localhost:8317/v1' },
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });
        const deepSeek = await resolveSessionIdentity({}, {
            env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' },
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });

        expect(clip.provider.displayName).toBe('ClipProxyAPI');
        expect(deepSeek.provider.displayName).toBe('DeepSeek');
    });

    it('sanitizes unknown endpoint labels to the hostname', async () => {
        const resolved = await resolveSessionIdentity({}, {
            env: { ANTHROPIC_BASE_URL: 'https://unknown.example/secret/path?token=value' },
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });

        expect(resolved.provider.displayName).toBe('unknown.example');
    });

    it('uses native model and effort inputs when transcript facts are absent', async () => {
        const data: StatusJSON = {
            model: { id: 'gpt-5.6-sol', display_name: 'logical alias' },
            effort: { level: 'xhigh' }
        };
        const resolved = await resolveSessionIdentity(data, {
            env: {},
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });

        expect(resolved.model).toMatchObject({
            raw: 'gpt-5.6-sol',
            displayName: 'GPT 5.6 Sol',
            source: 'stdin'
        });
        expect(resolved.effort).toEqual({ level: 'xhigh', source: 'stdin' });
    });

    it('extracts effort when a context suffix follows the model effort suffix', async () => {
        const resolved = await resolveSessionIdentity({ model: 'gpt-5.6-sol (high) [1M]' }, {
            env: {},
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });

        expect(resolved.model.displayName).toBe('GPT 5.6 Sol [1M]');
        expect(resolved.effort).toEqual({ level: 'high', source: 'model-suffix' });
    });

    it('separates compact basis and percentage trigger', async () => {
        const data: StatusJSON = {
            model: 'deepseek',
            context_window: {
                current_usage: {
                    input_tokens: 50000,
                    cache_read_input_tokens: 8000
                }
            }
        };
        const resolved = await resolveSessionIdentity(data, {
            env: {
                CLAUDE_CODE_AUTO_COMPACT_WINDOW: '64000',
                CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80'
            },
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });

        expect(resolved.context).toMatchObject({
            usedTokens: 58000,
            fullLimit: 1000000,
            autoCompactBasis: 64000,
            autoCompactThreshold: 51200,
            compactionState: 'enabled'
        });
    });

    it('distinguishes automatic and complete compaction disablement', async () => {
        const automatic = await resolveSessionIdentity({ model: 'deepseek' }, {
            env: {
                DISABLE_AUTO_COMPACT: '1',
                CLAUDE_CODE_AUTO_COMPACT_WINDOW: '64000',
                CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80'
            },
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });
        const complete = await resolveSessionIdentity({ model: 'deepseek' }, {
            env: {
                DISABLE_COMPACT: '1',
                CLAUDE_CODE_AUTO_COMPACT_WINDOW: '64000'
            },
            providerRegistry: PROVIDERS,
            modelRegistry: MODELS
        });

        expect(automatic.context).toMatchObject({
            compactionState: 'auto-disabled',
            autoCompactBasis: 64000
        });
        expect(automatic.context.autoCompactThreshold).toBeUndefined();
        expect(complete.context.compactionState).toBe('disabled');
        expect(complete.context.autoCompactBasis).toBeUndefined();
    });
});
