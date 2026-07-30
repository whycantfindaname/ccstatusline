import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

export class ProviderWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the provider resolved from the current statusline process environment'; }
    getDisplayName(): string { return 'Provider'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const provider = context.sessionIdentity?.provider.displayName;
        if (!provider) {
            return context.isPreview ? (item.rawValue ? 'ClipProxyAPI' : 'Provider ClipProxyAPI') : null;
        }
        return item.rawValue ? provider : `Provider ${provider}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
