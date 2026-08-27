import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    getLastSkillFromTranscript,
    getSkillsFilePath,
    getSkillsMetrics
} from '../skills';

let testHomeDir = '';

function writeSkillsLog(sessionId: string, lines: string[]): void {
    const skillsPath = getSkillsFilePath(sessionId);
    fs.mkdirSync(path.dirname(skillsPath), { recursive: true });
    fs.writeFileSync(skillsPath, lines.join('\n'), 'utf-8');
}

function writeTranscript(lines: unknown[]): string {
    const transcriptPath = path.join(testHomeDir, 'transcript.jsonl');
    fs.writeFileSync(
        transcriptPath,
        lines.map(entry => JSON.stringify(entry)).join('\n'),
        'utf-8'
    );
    return transcriptPath;
}

describe('skills metrics', () => {
    beforeEach(() => {
        testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-home-'));
        vi.spyOn(os, 'homedir').mockReturnValue(testHomeDir);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (testHomeDir) {
            fs.rmSync(testHomeDir, { recursive: true, force: true });
        }
    });

    it('uses ~/.cache/ccstatusline/skills path for skill logs', () => {
        expect(getSkillsFilePath('session-1')).toBe(
            path.join(testHomeDir, '.cache', 'ccstatusline', 'skills', 'skills-session-1.jsonl')
        );
    });

    it('returns total, unique (most-recent-first), and last skill from a valid log', () => {
        writeSkillsLog('session-1', [
            JSON.stringify({ skill: 'commit', session_id: 'session-1' }),
            JSON.stringify({ skill: 'review-pr', session_id: 'session-1' }),
            JSON.stringify({ skill: 'lint', session_id: 'session-1' }),
            JSON.stringify({ skill: 'commit', session_id: 'session-1' })
        ]);

        expect(getSkillsMetrics('session-1')).toEqual({
            totalInvocations: 4,
            uniqueSkills: ['commit', 'lint', 'review-pr'],
            lastSkill: 'commit'
        });
    });
});

describe('getLastSkillFromTranscript', () => {
    beforeEach(() => {
        testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-home-'));
        vi.spyOn(os, 'homedir').mockReturnValue(testHomeDir);
        fs.mkdirSync(path.join(testHomeDir, '.qoder-cn', 'skills', 'neat-freak'), { recursive: true });
        fs.writeFileSync(path.join(testHomeDir, '.qoder-cn', 'skills', 'neat-freak', 'SKILL.md'), 'x', 'utf-8');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (testHomeDir) {
            fs.rmSync(testHomeDir, { recursive: true, force: true });
        }
    });

    it('returns null when no transcript path is given', () => {
        expect(getLastSkillFromTranscript(undefined)).toBeNull();
    });

    it('returns null when the transcript does not exist', () => {
        expect(getLastSkillFromTranscript(path.join(testHomeDir, 'missing.jsonl'))).toBeNull();
    });

    it('prefers the most recent Skill tool_use from assistant entries', () => {
        const transcriptPath = writeTranscript([
            {
                type: 'assistant',
                message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'commit' } }] }
            },
            {
                type: 'assistant',
                message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'review-pr' } }] }
            }
        ]);

        expect(getLastSkillFromTranscript(transcriptPath)).toBe('review-pr');
    });

    it('resolves slash command activations that match an installed skill', () => {
        const transcriptPath = writeTranscript([
            { type: 'user', message: { content: '<command-name>/model</command-name>\nbuilt-in' } },
            { type: 'user', message: { content: '<command-message>neat-freak</command-message>\n<command-name>/neat-freak</command-name>' } }
        ]);

        expect(getLastSkillFromTranscript(transcriptPath)).toBe('neat-freak');
    });

    it('returns null when user entries only contain commands without an installed skill', () => {
        const transcriptPath = writeTranscript([
            { type: 'user', message: { content: '<command-name>/status</command-name>' } },
            { type: 'assistant', message: { content: [{ type: 'text', text: 'plain reply' }] } }
        ]);

        expect(getLastSkillFromTranscript(transcriptPath)).toBeNull();
    });

    it('ignores command-name references in tool results and assistant prose', () => {
        const transcriptPath = writeTranscript([
            { type: 'user', message: { content: '<command-name>/neat-freak</command-name>' } },
            {
                type: 'user',
                message: {
                    content: [
                        { type: 'tool_result', content: '<command-name>/leaked-tag</command-name>' }
                    ]
                }
            },
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'mentions <command-name>quoted-tag</command-name> in prose' }] }
            }
        ]);

        expect(getLastSkillFromTranscript(transcriptPath)).toBe('neat-freak');
    });
});
