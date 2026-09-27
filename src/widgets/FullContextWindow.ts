import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatTokens } from '../utils/renderer';

function tokenValue(value: number | undefined): string {
    return value === undefined ? 'unknown' : formatTokens(value, {}, 0);
}

export class FullContextWindowWidget implements Widget {
    getDefaultColor(): string { return 'blue'; }
    getDescription(): string { return 'Shows used tokens against the full model context window'; }
    getDisplayName(): string { return 'Full Context Window'; }
    getCategory(): string { return 'Context'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? '58k/200k full' : 'Context 58k/200k full';
        }
        const resolved = context.sessionIdentity?.context;
        if (resolved?.usedTokens === undefined) {
            return null;
        }
        const value = `${tokenValue(resolved.usedTokens)}/${tokenValue(resolved.fullLimit)} full`;
        return item.rawValue ? value : `Context ${value}`;
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
        const used = context.isPreview ? 58000 : resolved?.usedTokens;
        const full = context.isPreview ? 200000 : resolved?.fullLimit;
        if (used === undefined) {
            return null;
        }
        const value = `${tokenValue(used)}/${tokenValue(full)}`;
        return mode === 'short' ? `Ctx ${value}` : value;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
