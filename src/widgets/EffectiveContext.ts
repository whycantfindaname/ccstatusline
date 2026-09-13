import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatTokens } from '../utils/renderer';

function tokenValue(value: number | undefined): string {
    return value === undefined ? '?' : formatTokens(value, {}, 0);
}

export class EffectiveContextWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string { return 'Shows the auto-compact basis and calculated trigger separately from full context'; }
    getDisplayName(): string { return 'Effective Context'; }
    getCategory(): string { return 'Context'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? '58k/51k trigger (64k basis)' : 'Compact 58k/51k trigger (64k basis)';
        }

        const resolved = context.sessionIdentity?.context;
        if (!resolved) {
            return null;
        }
        if (resolved.compactionState === 'disabled') {
            return 'Compact off';
        }
        if (resolved.compactionState === 'auto-disabled') {
            const value = resolved.autoCompactBasis
                ? `off (${tokenValue(resolved.autoCompactBasis)} basis)`
                : 'off';
            return item.rawValue ? value : `Auto-compact ${value}`;
        }
        if (!resolved.autoCompactBasis) {
            return null;
        }

        const used = tokenValue(resolved.usedTokens);
        const value = resolved.autoCompactThreshold
            ? `${used}/${tokenValue(resolved.autoCompactThreshold)} trigger (${tokenValue(resolved.autoCompactBasis)} basis)`
            : `${used}/${tokenValue(resolved.autoCompactBasis)} basis`;
        return item.rawValue ? value : `Compact ${value}`;
    }

    renderResponsive(
        item: WidgetItem,
        context: RenderContext,
        settings: Settings,
        mode: 'full' | 'short' | 'value-only' | 'hidden'
    ): string | null {
        if (mode === 'hidden') {
            return null;
        }
        if (mode === 'full') {
            return this.render(item, context, settings);
        }

        const resolved = context.sessionIdentity?.context;
        const state = context.isPreview ? 'enabled' : resolved?.compactionState;
        if (state === 'disabled') {
            return mode === 'short' ? 'Cmp off' : 'off';
        }
        if (state === 'auto-disabled') {
            return mode === 'short' ? 'Auto off' : 'off';
        }
        const used = context.isPreview ? 58000 : resolved?.usedTokens;
        const basis = context.isPreview ? 64000 : resolved?.autoCompactBasis;
        const threshold = context.isPreview ? 51000 : resolved?.autoCompactThreshold;
        if (basis === undefined) {
            return null;
        }
        const value = threshold === undefined
            ? `${tokenValue(used)}/${tokenValue(basis)}`
            : `${tokenValue(used)}/${tokenValue(threshold)}@${tokenValue(basis)}`;
        return mode === 'short' ? `Cmp ${value}` : value;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
