import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { SettingsSchema } from '../../types/Settings';
import { getVisibleWidth } from '../ansi';
import { planResponsiveLine } from '../responsive-layout';

const SETTINGS = SettingsSchema.parse(JSON.parse(
    fs.readFileSync(path.resolve('config/statusline/settings.json'), 'utf8')
));

function plannedWidth(contents: string[]): number {
    const visible = contents.filter(Boolean);
    return visible.reduce((sum, content) => sum + getVisibleWidth(content), 0)
        + Math.max(0, visible.length - 1) * getVisibleWidth(SETTINGS.defaultSeparator ?? '');
}

describe('responsive layout planner', () => {
    it('keeps every configured line within widths 40 through 160', () => {
        for (let width = 40; width <= 160; width++) {
            const context: RenderContext = {
                isPreview: true,
                terminalWidth: width,
                minimalist: false
            };
            for (const line of SETTINGS.lines) {
                const planned = planResponsiveLine(line, SETTINGS, context);
                expect(plannedWidth(planned.map(item => item.content))).toBeLessThanOrEqual(width);
            }
        }
    });

    it('preserves provider and model at the narrowest width', () => {
        const planned = planResponsiveLine(SETTINGS.lines[0] ?? [], SETTINGS, {
            isPreview: true,
            terminalWidth: 40,
            minimalist: false
        });
        const content = planned.map(item => item.content).filter(Boolean).join(' ');

        expect(content).toContain('ClipProxyAPI');
        expect(content).toContain('Claude');
    });

    it('renders cwd as one complete absolute path or hides it without internal truncation', () => {
        const cwd = '/work/projects/example/ccstatusline';
        const cwdWidget = SETTINGS.lines
            .flat()
            .find(item => item.type === 'current-working-dir');

        expect(cwdWidget).toBeDefined();
        expect(cwdWidget?.metadata?.segments).toBeUndefined();
        expect(cwdWidget?.metadata?.abbreviateHome).toBeUndefined();
        expect(cwdWidget?.responsive?.allowValueTruncate).not.toBe(true);

        for (let width = 40; width <= 160; width++) {
            const planned = planResponsiveLine(cwdWidget ? [cwdWidget] : [], SETTINGS, {
                data: { cwd },
                isPreview: false,
                terminalWidth: width,
                minimalist: false
            });
            const content = planned[0]?.content ?? '';

            expect(content === '' || content.includes(cwd)).toBe(true);
            expect(content).not.toContain('...');
            expect(content).not.toBe('ccstatusline');
        }
    });

    it('keeps the full cwd in the wide-layout golden output', () => {
        const cwd = '/work/projects/example/ccstatusline';
        const cwdWidget = SETTINGS.lines
            .flat()
            .find(item => item.type === 'current-working-dir');
        const planned = planResponsiveLine(cwdWidget ? [cwdWidget] : [], SETTINGS, {
            data: { cwd },
            isPreview: false,
            terminalWidth: 160,
            minimalist: false
        });

        expect(planned.map(item => item.content).filter(Boolean)).toEqual([`cwd: ${cwd}`]);
    });
});
