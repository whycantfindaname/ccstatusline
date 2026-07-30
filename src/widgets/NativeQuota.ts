import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

function percentage(value: number | null | undefined): string | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? `${Math.max(0, Math.min(100, value)).toFixed(0)}%`
        : null;
}

export class NativeQuotaWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows native Claude Code five-hour and seven-day rate-limit usage'; }
    getDisplayName(): string { return 'Native Quota'; }
    getCategory(): string { return 'Usage'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? '5h 20% · 7d 12%' : 'Quota 5h 20% · 7d 12%';
        }

        const fiveHour = percentage(context.data?.rate_limits?.five_hour?.used_percentage);
        const sevenDay = percentage(context.data?.rate_limits?.seven_day?.used_percentage);
        const parts = [
            ...(fiveHour ? [`5h ${fiveHour}`] : []),
            ...(sevenDay ? [`7d ${sevenDay}`] : [])
        ];
        if (parts.length === 0) {
            return null;
        }
        const value = parts.join(' · ');
        return item.rawValue ? value : `Quota ${value}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
