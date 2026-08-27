import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

function formatQuota(remaining: number | undefined, total: number | undefined, percentage: number | undefined): string {
    const pct = percentage !== undefined ? ` · ${percentage}%` : '';
    if (remaining !== undefined && total !== undefined) {
        return `${remaining}/${total}${pct}`;
    }
    if (remaining !== undefined) {
        return `${remaining}${pct}`;
    }
    if (percentage !== undefined) {
        return `${percentage}%`;
    }
    return '';
}

export class QoderCreditsWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string { return 'Shows remaining credits / quota reported by the host CLI payload'; }
    getDisplayName(): string { return 'Credits'; }
    getCategory(): string { return 'Usage'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        void settings;

        if (context.isPreview) {
            return formatRawOrLabeledValue(item, '⚡ ', '1927/2000 · 4%');
        }

        const credits = context.data?.credits;
        if (!credits) {
            return null;
        }

        if (credits.is_quota_exceeded) {
            return formatRawOrLabeledValue(item, '⚡ ', 'EXCEEDED');
        }

        const quota = credits.user_quota ?? {};
        const value = formatQuota(
            quota.remaining ?? credits.total_remaining,
            quota.total,
            quota.percentage ?? credits.total_usage_percentage
        );
        if (!value) {
            return null;
        }

        return formatRawOrLabeledValue(item, '⚡ ', value);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
