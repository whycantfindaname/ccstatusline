import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
    SkillInvocation,
    SkillsMetrics
} from '../types/SkillsMetrics';

const EMPTY: SkillsMetrics = { totalInvocations: 0, uniqueSkills: [], lastSkill: null };

function getSkillsDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'skills');
}

export function getSkillsFilePath(sessionId: string): string {
    return path.join(getSkillsDir(), `skills-${sessionId}.jsonl`);
}

export function getSkillsMetrics(sessionId: string): SkillsMetrics {
    const filePath = getSkillsFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return EMPTY;
    }

    try {
        const invocations: SkillInvocation[] = fs.readFileSync(filePath, 'utf-8')
            .trim().split('\n')
            .filter(line => line.trim())
            .map((line) => {
                try { return JSON.parse(line) as SkillInvocation; } catch {
                    return null;
                }
            })
            .filter((e): e is SkillInvocation => e !== null && typeof e.skill === 'string' && typeof e.session_id === 'string');
        if (invocations.length === 0) {
            return EMPTY;
        }

        const uniqueSkills: string[] = [];
        const seenSkills = new Set<string>();
        for (let i = invocations.length - 1; i >= 0; i--) {
            const skill = invocations[i]?.skill;
            if (skill && !seenSkills.has(skill)) {
                seenSkills.add(skill);
                uniqueSkills.push(skill);
            }
        }

        return {
            totalInvocations: invocations.length,
            uniqueSkills,
            lastSkill: invocations[invocations.length - 1]?.skill ?? null
        };
    } catch {
        return EMPTY;
    }
}

const COMMAND_NAME_PATTERN = /<command-name>([^<]+)<\/command-name>/g;
const SKILLS_DIR_CANDIDATES = ['.qoder-cn/skills', '.qoder/skills', '.claude/skills', '.codex/skills', '.agents/skills'];

function isInstalledSkill(name: string): boolean {
    const home = os.homedir();
    return SKILLS_DIR_CANDIDATES.some(dir => fs.existsSync(path.join(home, dir, name, 'SKILL.md')));
}

function extractCommandNames(text: string): string[] {
    COMMAND_NAME_PATTERN.lastIndex = 0;
    const names: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = COMMAND_NAME_PATTERN.exec(text)) !== null) {
        const name = (match[1] ?? '').trim();
        if (name) {
            names.push(name);
        }
    }
    return names;
}

function extractInstalledSkillFromText(text: string): string | null {
    const names = extractCommandNames(text);
    for (let i = names.length - 1; i >= 0; i--) {
        const name = (names[i] ?? '').replace(/^\//, '');
        if (name && isInstalledSkill(name)) {
            return name;
        }
    }
    return null;
}

function extractSkillFromEntry(entry: unknown): string | null {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const record = entry as { type?: unknown; message?: { content?: unknown } };
    const content = record.message?.content;
    if (!Array.isArray(content)) {
        return record.type === 'user' && typeof content === 'string'
            ? extractInstalledSkillFromText(content)
            : null;
    }
    if (record.type === 'assistant') {
        for (const block of content) {
            if (!block || typeof block !== 'object') {
                continue;
            }
            const toolUse = block as { type?: string; name?: string; input?: { skill?: unknown } };
            if (toolUse.type === 'tool_use' && toolUse.name === 'Skill'
                && typeof toolUse.input?.skill === 'string' && toolUse.input.skill.trim()) {
                return toolUse.input.skill.trim();
            }
        }
        return null;
    }
    if (record.type === 'user') {
        for (const block of content) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
                const found = extractInstalledSkillFromText((block as { text?: string }).text ?? '');
                if (found) {
                    return found;
                }
            }
        }
    }
    return null;
}

export function getLastSkillFromTranscript(transcriptPath: string | undefined): string | null {
    if (!transcriptPath) {
        return null;
    }

    try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i]?.trim();
            if (!line) {
                continue;
            }
            try {
                const skill = extractSkillFromEntry(JSON.parse(line));
                if (skill) {
                    return skill;
                }
            } catch {
                // Skip malformed transcript lines
            }
        }
    } catch {
        // Transcript not readable
    }

    return null;
}
