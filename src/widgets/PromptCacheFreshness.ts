import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

function formatAge(timestamp: string): string | null {
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    const totalMinutes = Math.max(0, Math.floor((Date.now() - parsed) / 60000));
    if (totalMinutes < 1) {
        return '<1m';
    }
    if (totalMinutes < 60) {
        return `${totalMinutes}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}

export class PromptCacheFreshnessWidget implements Widget {
    getDefaultColor(): string { return 'brightBlack'; }
    getDescription(): string { return 'Shows the age of the newest transcript record with prompt-cache tokens'; }
    getDisplayName(): string { return 'Prompt Cache Age'; }
    getCategory(): string { return 'Context'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? '47m' : 'Cache age 47m';
        }
        const timestamp = context.sessionIdentity?.activity.cacheTimestamp;
        const age = timestamp ? formatAge(timestamp) : null;
        if (!age) {
            return null;
        }
        return item.rawValue ? age : `Cache age ${age}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
