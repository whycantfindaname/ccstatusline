#!/usr/bin/env node
import chalk from 'chalk';
import {
    spawn,
    spawnSync
} from 'node:child_process';

import type { SkillsMetrics } from './types';
import type { RenderContext } from './types/RenderContext';
import type { ResolvedSessionIdentity } from './types/SessionIdentity';
import type { StatusJSON } from './types/StatusJSON';
import { StatusJSONSchema } from './types/StatusJSON';
import {
    applyActivityHook,
    reconcileActivityTasks
} from './utils/activity-ledger';
import { getVisibleText } from './utils/ansi';
import { prefetchClaudeStatusIfNeeded } from './utils/claude-service-status';
import { updateColorMap } from './utils/colors';
import { ZERO_COMPACTION_STATS } from './utils/compaction';
import {
    getConfigLoadError,
    initConfigPath,
    loadSettings,
    saveSettings
} from './utils/config';
import {
    GIT_CHANGE_REFRESH_FLAG,
    refreshGitChangeCacheFromCli
} from './utils/git-change-cache';
import {
    GIT_REVIEW_REFRESH_FLAG,
    refreshGitReviewCacheFromCli
} from './utils/git-review-cache';
import { handleHookInput } from './utils/hook-handler';
import { getTranscriptAnalysis } from './utils/jsonl';
import { advanceGlobalPowerlineThemeIndex } from './utils/powerline-theme-index';
import { RenderDeadline } from './utils/render-deadline';
import {
    buildConfigWarningBadge,
    calculateMaxWidthsFromPreRendered,
    countPowerlineStartCapSlots,
    preRenderAllWidgets,
    renderStatusLine
} from './utils/renderer';
import { advanceGlobalSeparatorIndex } from './utils/separator-index';
import { resolveSessionIdentity } from './utils/session-identity';
import { getSkillsMetrics } from './utils/skills';
import {
    getWidgetSpeedWindowSeconds,
    isWidgetSpeedWindowEnabled
} from './utils/speed-window';
import {
    getPackageVersion,
    getTerminalWidth
} from './utils/terminal';
import { prefetchUsageDataIfNeeded } from './utils/usage-prefetch';

function hasSessionDurationInStatusJson(data: StatusJSON): boolean {
    const durationMs = data.cost?.total_duration_ms;
    return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0;
}

async function readStdin(): Promise<string | null> {
    // Check if stdin is a TTY (terminal) - if it is, there's no piped data
    if (process.stdin.isTTY) {
        return null;
    }

    const chunks: string[] = [];

    try {
        // Use Node.js compatible approach
        if (typeof Bun !== 'undefined') {
            // Bun environment
            const decoder = new TextDecoder();
            for await (const chunk of Bun.stdin.stream()) {
                chunks.push(decoder.decode(chunk));
            }
        } else {
            // Node.js environment
            process.stdin.setEncoding('utf8');
            for await (const chunk of process.stdin) {
                chunks.push(chunk as string);
            }
        }
        return chunks.join('');
    } catch {
        return null;
    }
}

async function ensureWindowsUtf8CodePage() {
    if (process.platform !== 'win32') {
        return;
    }

    try {
        const { execFileSync } = await import('child_process');
        execFileSync('chcp.com', ['65001'], { stdio: 'ignore', windowsHide: true });
    } catch {
        // Ignore failures to preserve statusline output even in restricted shells.
    }
}

async function renderMultipleLines(data: StatusJSON) {
    const settings = await loadSettings();
    const configError = getConfigLoadError();
    const deadline = new RenderDeadline();

    // Set global chalk level based on settings
    chalk.level = settings.colorLevel;

    // Update color map after setting chalk level
    updateColorMap();

    // Get all lines to render
    const lines = settings.lines;

    // Check if session clock is needed
    const hasSessionClock = lines.some(line => line.some(item => item.type === 'session-clock'));

    const speedWidgetTypes = new Set(['output-speed', 'input-speed', 'total-speed']);
    const hasSpeedItems = lines.some(line => line.some(item => speedWidgetTypes.has(item.type)));
    const hasCompactionWidget = lines.some(line => line.some(item => item.type === 'compaction-counter'));
    const hasThinkingEffortWidget = lines.some(line => line.some(item => item.type === 'thinking-effort'));
    const hasSessionNameWidget = lines.some(line => line.some(item => item.type === 'session-name'));
    const needsTranscriptThinkingEffort = hasThinkingEffortWidget
        && (!data.effort || !('level' in data.effort));
    const requestedSpeedWindows = new Set<number>();
    for (const line of lines) {
        for (const item of line) {
            if (speedWidgetTypes.has(item.type) && isWidgetSpeedWindowEnabled(item)) {
                requestedSpeedWindows.add(getWidgetSpeedWindowSeconds(item));
            }
        }
    }

    const sessionIdentity = await resolveSessionIdentity(data, { deadline });
    const transcriptAnalysisPromise = data.transcript_path
        ? getTranscriptAnalysis(data.transcript_path, {
            includeSessionDuration: hasSessionClock && !hasSessionDurationInStatusJson(data),
            includeSpeedMetrics: hasSpeedItems,
            includeSubagents: true,
            speedWindowSeconds: Array.from(requestedSpeedWindows),
            includeCompactionStats: hasCompactionWidget,
            includeThinkingEffort: needsTranscriptThinkingEffort,
            includeSessionName: hasSessionNameWidget
        })
        : Promise.resolve(null);
    const [transcriptAnalysis, usageData, claudeStatusData] = await Promise.all([
        transcriptAnalysisPromise,
        prefetchUsageDataIfNeeded(lines, data),
        prefetchClaudeStatusIfNeeded(lines)
    ]);

    const tokenMetrics = transcriptAnalysis?.tokenMetrics ?? null;
    const sessionDuration = transcriptAnalysis?.sessionDuration
        ?? (hasSessionClock && !hasSessionDurationInStatusJson(data)
            ? formatResolvedSessionDuration(sessionIdentity)
            : null);
    const speedMetrics = transcriptAnalysis?.speedMetricsCollection?.sessionAverage ?? null;
    const windowedSpeedMetrics = transcriptAnalysis?.speedMetricsCollection?.windowed ?? null;

    let skillsMetrics: SkillsMetrics | null = null;
    const hasSkillsWidget = lines.some(line => line.some(item => item.type === 'skills'));
    if (hasSkillsWidget && data.session_id && !deadline.expired()) {
        skillsMetrics = getSkillsMetrics(data.session_id);
    }

    const compactionData = hasCompactionWidget
        ? (transcriptAnalysis?.compactionData ?? ZERO_COMPACTION_STATS)
        : null;

    // Create render context
    const context: RenderContext = {
        data,
        tokenMetrics,
        speedMetrics,
        windowedSpeedMetrics,
        usageData,
        claudeStatusData,
        sessionDuration,
        transcriptSessionName: hasSessionNameWidget
            ? (transcriptAnalysis?.sessionName ?? null)
            : undefined,
        transcriptThinkingEffort: needsTranscriptThinkingEffort
            ? (transcriptAnalysis?.thinkingEffort ?? null)
            : undefined,
        skillsMetrics,
        compactionData,
        sessionIdentity,
        renderDeadline: deadline,
        terminalWidth: getTerminalWidth({
            sessionId: data.session_id,
            ttlSeconds: settings.terminalWidthCacheTtlSeconds
        }),
        isPreview: false,
        minimalist: settings.minimalistMode,
        gitCacheTtlSeconds: settings.gitCacheTtlSeconds,
        customCommandCacheTtlSeconds: settings.customCommandCacheTtlSeconds,
        gitReviewNeedsChecks: lines.some(line => line.some(item => item.type === 'git-ci-status'))
    };

    // Always pre-render all widgets once (for efficiency)
    const preRenderedLines = preRenderAllWidgets(lines, settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

    // Render each line using pre-rendered content
    let globalSeparatorIndex = 0;
    let globalPowerlineThemeIndex = 0;
    let globalPowerlineStartCapIndex = 0;
    let configBadgePrepended = false;
    for (let i = 0; i < lines.length; i++) {
        const lineItems = lines[i];
        if (lineItems && lineItems.length > 0) {
            const preRenderedWidgets = preRenderedLines[i] ?? [];
            const lineContext = {
                ...context,
                lineIndex: i,
                globalSeparatorIndex,
                globalPowerlineThemeIndex,
                globalPowerlineStartCapIndex
            };
            let line = renderStatusLine(lineItems, settings, lineContext, preRenderedWidgets, preCalculatedMaxWidths);

            // Only output the line if it has content (not just ANSI codes)
            // Strip ANSI codes to check if there's actual text
            const strippedLine = getVisibleText(line).trim();
            if (strippedLine.length > 0) {
                if (configError && !configBadgePrepended) {
                    // On the error path settings are always inMemoryDefaults(), whose separators render as ' | '.
                    line = `${buildConfigWarningBadge(settings.colorLevel)} | ${line}`;
                    configBadgePrepended = true;
                }

                // Replace all spaces with non-breaking spaces to prevent VSCode trimming
                let outputLine = line.replace(/ /g, '\u00A0');

                // Add reset code at the beginning to override Claude Code's dim setting
                outputLine = '\x1b[0m' + outputLine;
                console.log(outputLine);

                globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems, preRenderedWidgets);
                if (settings.powerline.enabled) {
                    globalPowerlineStartCapIndex += countPowerlineStartCapSlots(lineItems, preRenderedWidgets);
                }
                if (settings.powerline.enabled && settings.powerline.continueThemeAcrossLines) {
                    globalPowerlineThemeIndex = advanceGlobalPowerlineThemeIndex(globalPowerlineThemeIndex, preRenderedWidgets);
                }
            }
        }
    }

    // Defensive fallback: if no content line was emitted, ensure the warning is not lost
    if (configError && !configBadgePrepended) {
        console.log('\x1b[0m' + buildConfigWarningBadge(settings.colorLevel).replace(/ /g, '\u00A0'));
    }

    // Check if there's an update message to display
    if (settings.updatemessage?.message
        && settings.updatemessage.message.trim() !== ''
        && settings.updatemessage.remaining
        && settings.updatemessage.remaining > 0) {
        // Display the message
        console.log(settings.updatemessage.message);

        // Decrement the remaining count
        const newRemaining = settings.updatemessage.remaining - 1;

        // Update or remove the updatemessage
        if (newRemaining <= 0) {
            // Remove the entire updatemessage block
            const { updatemessage, ...newSettings } = settings;
            await saveSettings(newSettings);
        } else {
            // Update the remaining count
            await saveSettings({
                ...settings,
                updatemessage: {
                    ...settings.updatemessage,
                    remaining: newRemaining
                }
            });
        }
    }
}

function formatResolvedSessionDuration(identity: ResolvedSessionIdentity): string | null {
    const start = identity.activity.sessionStartedAt
        ? Date.parse(identity.activity.sessionStartedAt)
        : Number.NaN;
    const end = identity.activity.sessionUpdatedAt
        ? Date.parse(identity.activity.sessionUpdatedAt)
        : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return null;
    }
    const totalMinutes = Math.floor((end - start) / 60000);
    if (totalMinutes < 1) {
        return '<1m';
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) {
        return `${minutes}m`;
    }
    return minutes === 0 ? `${hours}hr` : `${hours}hr ${minutes}m`;
}

function parseConfigArg(): string | undefined {
    const idx = process.argv.indexOf('--config');
    if (idx === -1)
        return undefined;
    const configPath = process.argv[idx + 1];
    if (!configPath || configPath.startsWith('--')) {
        console.error('--config requires a file path argument');
        process.exit(1);
    }
    process.argv.splice(idx, 2);
    return configPath;
}

async function handleHook(): Promise<void> {
    const input = await readStdin();
    handleHookInput(input);
}

async function handleActivityHook(): Promise<void> {
    const input = await readStdin();
    if (!input) {
        return;
    }
    // The managed deployment uses one stable hook dispatcher for both widget
    // events and lifecycle activity. Each handler ignores events it does not own.
    handleHookInput(input);
    try {
        const parsed = JSON.parse(input) as unknown;
        if (parsed && typeof parsed === 'object') {
            await applyActivityHook(parsed, { deadline: new RenderDeadline(1500) });
        }
    } catch {
        // Lifecycle observability is best-effort and intentionally silent.
    }
}

function sanitizeTaskText(value: unknown): string {
    return typeof value === 'string'
        ? value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim()
        : '';
}

async function renderSubagentStatusLine(data: StatusJSON): Promise<void> {
    await reconcileActivityTasks(data.session_id, data.tasks, { deadline: new RenderDeadline(350) });

    const columns = typeof data.columns === 'number' && Number.isFinite(data.columns)
        ? Math.max(20, Math.min(1000, Math.floor(data.columns)))
        : 100;
    for (const task of data.tasks ?? []) {
        const id = sanitizeTaskText(task.id);
        if (!id) {
            continue;
        }
        const title = sanitizeTaskText(task.name ?? task.label ?? task.type ?? task.id);
        const description = sanitizeTaskText(task.description);
        const tokenCount = typeof task.tokenCount === 'number' && Number.isFinite(task.tokenCount)
            ? `${Math.max(0, Math.floor(task.tokenCount)).toLocaleString('en-US')} tokens`
            : '';
        const content = [title, description, tokenCount].filter(Boolean).join(' · ');
        console.log(JSON.stringify({
            id,
            content: getVisibleText(content).slice(0, columns)
        }));
    }
}

function handleGitReviewRefresh(): boolean {
    const flagIndex = process.argv.indexOf(GIT_REVIEW_REFRESH_FLAG);
    if (flagIndex === -1) {
        return false;
    }

    const cwd = process.argv[flagIndex + 1];
    const mode = process.argv[flagIndex + 2];
    const lockPath = process.argv[flagIndex + 3];
    if (!cwd || (mode !== 'metadata' && mode !== 'checks') || !lockPath) {
        return true;
    }

    refreshGitReviewCacheFromCli(cwd, { includeChecks: mode === 'checks' }, lockPath);
    return true;
}

function handleGitChangeRefresh(): boolean {
    const flagIndex = process.argv.indexOf(GIT_CHANGE_REFRESH_FLAG);
    if (flagIndex === -1) {
        return false;
    }

    const cwd = process.argv[flagIndex + 1];
    const lockPath = process.argv[flagIndex + 2];
    if (cwd && lockPath) {
        refreshGitChangeCacheFromCli(cwd, lockPath);
    }
    return true;
}

async function handleSupervisedCommand(): Promise<boolean> {
    const flagIndex = process.argv.indexOf('--internal-supervise');
    if (flagIndex === -1) {
        return false;
    }
    const duration = process.argv[flagIndex + 1];
    const command = process.argv[flagIndex + 2];
    if (!duration || !command || !/^\d+(?:\.\d+)?$/.test(duration)) {
        process.exitCode = 2;
        return true;
    }

    const child = spawn(command, process.argv.slice(flagIndex + 3), {
        detached: process.platform !== 'win32',
        stdio: 'inherit',
        windowsHide: true
    });
    const timeoutMs = Number(duration) * 1000;
    await new Promise<void>((resolve) => {
        let closed = false;
        let finished = false;
        let killPhase = false;
        let timedOut = false;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (exitCode: number) => {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(deadlineTimer);
            if (graceTimer) {
                clearTimeout(graceTimer);
            }
            process.exitCode = exitCode;
            resolve();
        };
        const signalTree = (signal: NodeJS.Signals) => {
            if (!child.pid) {
                return;
            }
            try {
                if (process.platform === 'win32') {
                    const systemRoot = process.env.SystemRoot
                        ?? process.env.WINDIR
                        ?? 'C:\\Windows';
                    const taskkill = `${systemRoot}\\System32\\taskkill.exe`;
                    const result = spawnSync(
                        taskkill,
                        ['/PID', String(child.pid), '/T', '/F'],
                        { stdio: 'ignore', windowsHide: true }
                    );
                    if (result.error || result.status !== 0) {
                        child.kill(signal);
                    }
                } else {
                    process.kill(-child.pid, signal);
                }
            } catch {
                // The process group may have exited between observation and signal.
            }
        };
        const deadlineTimer = setTimeout(() => {
            timedOut = true;
            signalTree('SIGTERM');
            if (process.platform === 'win32') {
                finish(124);
                return;
            }
            graceTimer = setTimeout(() => {
                killPhase = true;
                signalTree('SIGKILL');
                if (closed) {
                    finish(124);
                }
            }, 100);
        }, timeoutMs);
        child.once('error', () => {
            closed = true;
            if (!timedOut) {
                finish(1);
            } else if (killPhase || process.platform === 'win32') {
                finish(124);
            }
        });
        child.once('close', (code) => {
            closed = true;
            if (!timedOut) {
                finish(code ?? 1);
            } else if (killPhase || process.platform === 'win32') {
                finish(124);
            }
        });
    });
    return true;
}

async function main() {
    if (await handleSupervisedCommand()) {
        return;
    }

    // Detached cache refreshes re-enter this executable without reading stdin
    // or loading user settings. This mode intentionally emits no output.
    if (handleGitChangeRefresh() || handleGitReviewRefresh()) {
        return;
    }

    // Print version and exit (#461). Standard CLI behavior, runs before any other mode.
    if (process.argv.includes('--version')) {
        console.log(getPackageVersion());
        process.exit(0);
    }

    // Parse --config before anything else
    initConfigPath(parseConfigArg());

    // Handle --hook mode (cross-platform hook handler for widgets)
    if (process.argv.includes('--hook')) {
        await handleHook();
        return;
    }

    if (process.argv.includes('--activity-hook')) {
        await handleActivityHook();
        return;
    }

    // Check if we're in a piped/non-TTY environment first
    if (!process.stdin.isTTY) {
        await ensureWindowsUtf8CodePage();

        // We're receiving piped input
        const input = await readStdin();
        if (input && input.trim() !== '') {
            try {
                // Parse and validate JSON in one step
                const result = StatusJSONSchema.safeParse(JSON.parse(input));
                if (!result.success) {
                    console.error('Invalid status JSON format:', result.error.message);
                    process.exit(1);
                }

                if (process.argv.includes('--subagent')) {
                    await renderSubagentStatusLine(result.data);
                    return;
                }

                await renderMultipleLines(result.data);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                process.exit(1);
            }
        } else {
            console.error('No input received');
            process.exit(1);
        }
    } else {
        // Interactive mode - run TUI
        // Remove updatemessage before running TUI
        const settings = await loadSettings();
        if (settings.updatemessage) {
            const { updatemessage, ...newSettings } = settings;
            await saveSettings(newSettings);
        }
        // Imported lazily: the TUI pulls in ink/React/yoga-layout, which the
        // status line render path never touches. Claude Code re-runs this
        // binary every couple of seconds, so keeping that graph off the
        // render path is worth the dynamic import here.
        const { runTUI } = await import('./tui');
        runTUI();
    }
}

void main();
