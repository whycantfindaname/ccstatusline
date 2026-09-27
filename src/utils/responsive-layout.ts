import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { WidgetItem } from '../types/Widget';

import {
    getVisibleWidth,
    truncateStyledText
} from './ansi';
import { getWidget } from './widgets';

type ResponsiveMode = 'full' | 'short' | 'value-only' | 'hidden';

export interface ResponsivePreRenderedWidget {
    content: string;
    plainLength: number;
    widget: WidgetItem;
}

interface PlannedItem {
    widget: WidgetItem;
    modes: ResponsiveMode[];
    modeIndex: number;
    content: string;
}

function breakpointStart(widget: WidgetItem, width: number): ResponsiveMode | undefined {
    if (width < 72) {
        return widget.responsive?.narrowStart;
    }
    if (width < 100) {
        return widget.responsive?.mediumStart;
    }
    return undefined;
}

function initialModeIndex(widget: WidgetItem, width: number): number {
    const modes = widget.responsive?.variants ?? ['full'];
    const requested = breakpointStart(widget, width);
    const requestedIndex = requested ? modes.indexOf(requested) : 0;
    return requestedIndex >= 0 ? requestedIndex : 0;
}

function renderMode(
    widget: WidgetItem,
    mode: ResponsiveMode,
    context: RenderContext,
    settings: Settings
): string {
    if (mode === 'hidden') {
        return '';
    }
    const widgetImpl = getWidget(widget.type);
    if (!widgetImpl) {
        return '';
    }

    try {
        if (widgetImpl.renderResponsive) {
            return widgetImpl.renderResponsive(widget, context, settings, mode) ?? '';
        }

        if (mode === 'full') {
            const effectiveWidget = context.minimalist ? { ...widget, rawValue: true } : widget;
            return widgetImpl.render(effectiveWidget, context, settings) ?? '';
        }

        const value = widgetImpl.render({ ...widget, rawValue: true }, context, settings) ?? '';
        if (!value || mode === 'value-only') {
            return value;
        }
        const label = widget.responsive?.shortLabel?.trim();
        return label ? `${label} ${value}` : value;
    } catch {
        return '';
    }
}

function separatorWidth(settings: Settings): number {
    return settings.defaultSeparator ? getVisibleWidth(settings.defaultSeparator) : 0;
}

function plannedWidth(items: PlannedItem[], settings: Settings): number {
    const visible = items.filter(item => item.content.length > 0);
    if (visible.length === 0) {
        return 0;
    }
    const padding = settings.defaultPadding ?? '';
    const paddingWidth = getVisibleWidth(padding) * 2;
    return visible.reduce((sum, item) => sum + getVisibleWidth(item.content) + paddingWidth, 0)
        + separatorWidth(settings) * (visible.length - 1);
}

function nextDegradableItem(items: PlannedItem[]): PlannedItem | undefined {
    return items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.modeIndex < item.modes.length - 1)
        .sort((left, right) => {
            const priorityDifference = (left.item.widget.responsive?.visibilityPriority ?? Number.MAX_SAFE_INTEGER)
                - (right.item.widget.responsive?.visibilityPriority ?? Number.MAX_SAFE_INTEGER);
            return priorityDifference !== 0 ? priorityDifference : right.index - left.index;
        })[0]?.item;
}

function truncateAllowedValues(items: PlannedItem[], settings: Settings, width: number): void {
    let overflow = plannedWidth(items, settings) - width;
    if (overflow <= 0) {
        return;
    }

    const candidates = items
        .filter(item => item.content && item.widget.responsive?.allowValueTruncate)
        .sort((left, right) => getVisibleWidth(right.content) - getVisibleWidth(left.content));
    for (const item of candidates) {
        if (overflow <= 0) {
            break;
        }
        const currentWidth = getVisibleWidth(item.content);
        const targetWidth = Math.max(4, currentWidth - overflow);
        item.content = truncateStyledText(item.content, targetWidth, { ellipsis: true });
        overflow -= currentWidth - getVisibleWidth(item.content);
    }
}

export function planResponsiveLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext
): ResponsivePreRenderedWidget[] {
    const width = context.terminalWidth ?? 100;
    const items = widgets.map((widget): PlannedItem => {
        if (widget.type === 'separator' || widget.type === 'flex-separator') {
            return { widget, modes: ['hidden'], modeIndex: 0, content: '' };
        }
        const modes = widget.responsive?.variants ?? ['full'];
        const modeIndex = initialModeIndex(widget, width);
        return {
            widget,
            modes,
            modeIndex,
            content: renderMode(widget, modes[modeIndex] ?? 'full', context, settings)
        };
    });

    while (plannedWidth(items, settings) > width) {
        const item = nextDegradableItem(items);
        if (!item) {
            break;
        }
        item.modeIndex++;
        item.content = renderMode(
            item.widget,
            item.modes[item.modeIndex] ?? 'hidden',
            context,
            settings
        );
    }

    truncateAllowedValues(items, settings, width);
    return items.map(item => ({
        content: item.content,
        plainLength: getVisibleWidth(item.content),
        widget: item.widget
    }));
}
