import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class LinesChangedWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'Shows lines added/removed this session from the host CLI payload'; }
    getDisplayName(): string { return 'Lines Changed'; }
    getCategory(): string { return 'Session'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        void settings;

        if (context.isPreview) {
            return formatRawOrLabeledValue(item, 'Δ ', '+348 -265');
        }

        const cost = context.data?.cost;
        const added = cost?.total_lines_added;
        const removed = cost?.total_lines_removed;
        if (added === undefined && removed === undefined) {
            return null;
        }

        const value = `+${added ?? 0} -${removed ?? 0}`;
        if (added === 0 && removed === 0) {
            return null;
        }

        return formatRawOrLabeledValue(item, 'Δ ', value);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
