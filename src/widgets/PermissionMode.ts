import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

const MODE_LABELS: Record<string, string> = {
    bypassPermissions: 'bypass',
    acceptEdits: 'accept',
    plan: 'plan',
    default: 'default'
};

export class PermissionModeWidget implements Widget {
    getDefaultColor(): string { return 'brightBlack'; }
    getDescription(): string { return 'Shows the active permission mode from the host CLI payload'; }
    getDisplayName(): string { return 'Permission Mode'; }
    getCategory(): string { return 'Session'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        void settings;

        if (context.isPreview) {
            return formatRawOrLabeledValue(item, '🔓 ', 'bypass');
        }

        const mode = context.data?.permission_mode;
        if (!mode) {
            return null;
        }

        const label = MODE_LABELS[mode] ?? mode;
        return formatRawOrLabeledValue(item, '🔓 ', label);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
