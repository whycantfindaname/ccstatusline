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
    MAX_RECORD_BYTES,
    readTranscriptFacts
} from '../transcript-tail';

describe('bounded transcript tail reader', () => {
    let root: string;
    let transcriptPath: string;
    let cacheDir: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-tail-'));
        transcriptPath = path.join(root, 'transcript.jsonl');
        cacheDir = path.join(root, 'cache');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('finds a model in a complete 2.25 MiB record beyond the initial windows', async () => {
        const record = {
            type: 'assistant',
            timestamp: '2026-07-30T00:01:00.000Z',
            message: {
                role: 'assistant',
                model: 'gpt-5.6-sol',
                content: [{ type: 'text', text: 'x'.repeat(2_245_324) }]
            }
        };
        fs.writeFileSync(transcriptPath, `${JSON.stringify(record)}\n`);

        const facts = await readTranscriptFacts(transcriptPath, { cacheDir });

        expect(facts.latestAssistantModel).toBe('gpt-5.6-sol');
    });

    it('skips an oversized newest record and retains the preceding model', async () => {
        const previous = JSON.stringify({
            type: 'assistant',
            timestamp: '2026-07-30T00:01:00.000Z',
            message: { role: 'assistant', model: 'deepseek-chat', content: [] }
        });
        const oversized = JSON.stringify({
            type: 'assistant',
            timestamp: '2026-07-30T00:02:00.000Z',
            message: {
                role: 'assistant',
                model: 'should-be-skipped',
                content: [{ type: 'text', text: 'x'.repeat(MAX_RECORD_BYTES + 1024) }]
            }
        });
        fs.writeFileSync(transcriptPath, `${previous}\n${oversized}\n`);

        const facts = await readTranscriptFacts(transcriptPath, { cacheDir });

        expect(facts.latestAssistantModel).toBe('deepseek-chat');
    });

    it('keeps tool-result rows inside the latest human turn', async () => {
        const records = [
            {
                type: 'user',
                timestamp: '2026-07-30T00:00:00.000Z',
                origin: { kind: 'human', source: 'typed' },
                message: { role: 'user', content: 'implement this' }
            },
            {
                type: 'assistant',
                timestamp: '2026-07-30T00:01:00.000Z',
                message: {
                    role: 'assistant',
                    model: 'gpt-5.6-sol',
                    content: [{ type: 'tool_use' }, { type: 'tool_use' }]
                }
            },
            {
                type: 'user',
                timestamp: '2026-07-30T00:02:00.000Z',
                toolUseResult: { ok: true },
                message: { role: 'user', content: [{ type: 'tool_result' }] }
            },
            {
                type: 'assistant',
                timestamp: '2026-07-30T00:03:00.000Z',
                message: {
                    role: 'assistant',
                    model: 'gpt-5.6-sol',
                    content: [{ type: 'tool_use' }]
                }
            }
        ];
        fs.writeFileSync(transcriptPath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);

        const facts = await readTranscriptFacts(transcriptPath, { cacheDir });

        expect(facts.toolsLastTurn).toBe(3);
        expect(facts.sessionStartedAt).toBe('2026-07-30T00:00:00.000Z');
        expect(facts.sessionUpdatedAt).toBe('2026-07-30T00:03:00.000Z');
    });
});
