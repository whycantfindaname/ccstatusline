#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SettingsSchema } from '../src/types/Settings';
import { getActiveHookDefs } from '../src/utils/hooks';
import { getSkillsFilePath } from '../src/utils/skills';

import {
    buildManagedPatch,
    buildStatuslineDispatcher,
    collectJsonDifferencePaths,
    mergeManagedSettings as mergeManagedSettingsPure,
    mergeProviderRegistries,
    parseCCSwitchCommonConfig,
    parseProviderRegistry,
    restoreManagedSettings as restoreManagedSettingsPure,
    type JsonObject
} from './deploy-utils';

export type CCSwitchMode = 'auto' | 'off' | 'required';

export interface DeploymentPaths {
    backupRoot: string;
    configuredSettingsPath: string;
    repoRoot: string;
    settingsPath: string;
    targetRoot: string;
    validationRoot: string;
}

interface BackupMetadata {
    activeRelease: string | null;
    createdAt: string;
    hadCcSwitchCommon?: boolean;
    hadSettings: boolean;
    paths: Pick<DeploymentPaths, 'backupRoot' | 'settingsPath' | 'targetRoot'>;
    previousRelease: string | null;
    retainUntil: string;
    version: number;
}

interface ReleaseFile {
    content: Buffer;
    mode: number;
    relativePath: string;
}

interface ReleasePlan {
    files: ReleaseFile[];
    manifest: JsonObject;
    releaseId: string;
}

export interface DispatcherTools {
    findPath: string;
    mktempPath: string;
    sedPath: string;
    sha256Args: string[];
    sha256Path: string;
}

export interface ProviderResolution {
    registry: JsonObject;
    source: 'bundled' | 'ccswitch';
    warning?: string;
}

export interface CCSwitchCommonResolution {
    command: string | null;
    current: JsonObject | null;
    next: JsonObject | null;
    warning?: string;
}

interface CliOptions {
    action: 'apply' | 'check' | 'rollback';
    backupPath?: string;
    ccSwitchMode: CCSwitchMode;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;

function commandEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const proxyKeys = new Set([
        'all_proxy',
        'http_proxy',
        'https_proxy',
        'ALL_PROXY',
        'HTTP_PROXY',
        'HTTPS_PROXY'
    ]);
    return {
        ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !proxyKeys.has(key))
        ),
        ...overrides
    };
}

function run(
    command: string,
    args: string[],
    options: {
        capture?: boolean;
        cwd?: string;
        env?: NodeJS.ProcessEnv;
        input?: string;
        trimOutput?: boolean;
    } = {}
): string {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? REPO_ROOT,
        encoding: 'utf8',
        env: options.env ?? commandEnvironment(),
        input: options.input,
        stdio: options.capture
            ? [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
            : 'inherit'
    });
    if (result.status !== 0) {
        const diagnostic = options.capture
            ? [result.stderr, result.stdout]
                .filter(Boolean)
                .join('\n')
                .trim() || `${command} exited ${result.status}`
            : `${command} exited ${result.status}`;
        throw new Error(diagnostic);
    }
    if (!options.capture) {
        return '';
    }
    return options.trimOutput === false ? result.stdout : result.stdout.trim();
}

function commandPathOptional(command: string): string | null {
    if (command.includes(path.sep)) {
        try {
            fs.accessSync(path.resolve(command), fs.constants.X_OK);
            return path.resolve(command);
        } catch {
            return null;
        }
    }
    const result = spawnSync(
        '/bin/sh',
        ['-c', 'command -v "$1"', 'resolve-command', command],
        {
            encoding: 'utf8',
            env: commandEnvironment(),
            stdio: ['ignore', 'pipe', 'ignore']
        }
    );
    return result.status === 0 && result.stdout.trim().length > 0
        ? result.stdout.trim()
        : null;
}

function commandPath(command: string): string {
    const resolved = commandPathOptional(command);
    if (!resolved) {
        throw new Error(`Required command is unavailable: ${command}`);
    }
    return resolved;
}

function sha256(content: Buffer | string): string {
    return createHash('sha256').update(content).digest('hex');
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as JsonObject)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonicalize(nested)])
        );
    }
    return value;
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function readJson(filePath: string): JsonObject {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Expected a JSON object: ${filePath}`);
    }
    return parsed as JsonObject;
}

function readJsonOrEmpty(filePath: string): JsonObject {
    return fs.existsSync(filePath) ? readJson(filePath) : {};
}

async function writeFileAtomic(filePath: string, content: string, mode: number): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.promises.writeFile(tempPath, content, { encoding: 'utf8', mode });
        await fs.promises.rename(tempPath, filePath);
    } catch (error) {
        await fs.promises.unlink(tempPath).catch(() => undefined);
        throw error;
    }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

function resolveSettingsAuthority(configuredPath: string): string {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(configuredPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return configuredPath;
        }
        throw error;
    }
    if (stat.isSymbolicLink()) {
        try {
            return fs.realpathSync(configuredPath);
        } catch (error) {
            throw new Error(
                `Claude settings symlink is unresolved: ${configuredPath}`,
                { cause: error }
            );
        }
    }
    if (!stat.isFile()) {
        throw new Error(`Claude settings path is not a regular file: ${configuredPath}`);
    }
    return configuredPath;
}

export function resolveDeploymentPaths(
    environment: NodeJS.ProcessEnv = process.env
): DeploymentPaths {
    const home = environment.HOME ? path.resolve(environment.HOME) : null;
    const configRoot = environment.CLAUDE_CONFIG_DIR
        ? path.resolve(environment.CLAUDE_CONFIG_DIR)
        : home
            ? path.join(home, '.claude')
            : null;
    const configuredSettingsPath = environment.CCSTATUSLINE_SETTINGS_PATH
        ? path.resolve(environment.CCSTATUSLINE_SETTINGS_PATH)
        : configRoot
            ? path.join(configRoot, 'settings.json')
            : null;
    if (!configuredSettingsPath) {
        throw new Error(
            'HOME, CLAUDE_CONFIG_DIR, or CCSTATUSLINE_SETTINGS_PATH is required'
        );
    }

    const settingsPath = resolveSettingsAuthority(configuredSettingsPath);
    const settingsRoot = path.dirname(settingsPath);
    return {
        backupRoot: environment.CCSTATUSLINE_BACKUP_ROOT
            ? path.resolve(environment.CCSTATUSLINE_BACKUP_ROOT)
            : path.join(settingsRoot, 'backups', 'ccstatusline'),
        configuredSettingsPath,
        repoRoot: REPO_ROOT,
        settingsPath,
        targetRoot: environment.CCSTATUSLINE_INSTALL_ROOT
            ? path.resolve(environment.CCSTATUSLINE_INSTALL_ROOT)
            : path.join(settingsRoot, 'statusline'),
        validationRoot: environment.CCSTATUSLINE_VALIDATION_ROOT
            ? path.resolve(environment.CCSTATUSLINE_VALIDATION_ROOT)
            : REPO_ROOT
    };
}

function sourceTreeDigest(root: string): string {
    const digest = createHash('sha256');
    const inputs = [
        'config',
        'patches',
        'scripts',
        'src',
        'bun.lock',
        'eslint.config.js',
        'package.json',
        'tsconfig.json',
        'vitest.config.ts'
    ];

    const visit = (relativePath: string): void => {
        const absolutePath = path.join(root, relativePath);
        const stat = fs.lstatSync(absolutePath);
        if (stat.isDirectory()) {
            digest.update(`directory\0${relativePath}\0`);
            for (const child of fs.readdirSync(absolutePath).sort()) {
                visit(path.join(relativePath, child));
            }
            return;
        }
        if (stat.isSymbolicLink()) {
            digest.update(`symlink\0${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
            return;
        }
        if (!stat.isFile()) {
            throw new Error(`Unsupported validation input type: ${absolutePath}`);
        }
        digest.update(`file\0${relativePath}\0`);
        digest.update(fs.readFileSync(absolutePath));
        digest.update('\0');
    };

    for (const input of inputs) {
        visit(input);
    }
    return digest.digest('hex');
}

function activeReleasePath(paths: DeploymentPaths): string {
    return path.join(paths.targetRoot, 'active-release');
}

function previousReleasePath(paths: DeploymentPaths): string {
    return path.join(paths.targetRoot, 'previous-release');
}

function readReleasePointer(filePath: string): string | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const releaseId = fs.readFileSync(filePath, 'utf8').trim();
    if (!RELEASE_ID_PATTERN.test(releaseId)) {
        throw new Error(`Invalid release pointer: ${filePath}`);
    }
    return releaseId;
}

async function writeReleasePointer(filePath: string, releaseId: string | null): Promise<void> {
    if (releaseId === null) {
        await fs.promises.unlink(filePath).catch(() => undefined);
        return;
    }
    if (!RELEASE_ID_PATTERN.test(releaseId)) {
        throw new Error(`Invalid release id: ${releaseId}`);
    }
    await writeFileAtomic(filePath, `${releaseId}\n`, 0o644);
}

function managedPatch(paths: DeploymentPaths): JsonObject {
    const settings = SettingsSchema.parse(readJson(
        path.join(paths.repoRoot, 'config', 'statusline', 'settings.json')
    ));
    return buildManagedPatch(paths.targetRoot, getActiveHookDefs(settings));
}

function mergeManagedSettings(paths: DeploymentPaths, source: JsonObject): JsonObject {
    return mergeManagedSettingsPure(source, managedPatch(paths));
}

function restoreManagedSettings(
    paths: DeploymentPaths,
    current: JsonObject,
    backup: JsonObject
): JsonObject {
    return restoreManagedSettingsPure(current, backup, managedPatch(paths));
}

function releaseWrapper(paths: DeploymentPaths, hook: boolean): string {
    const extraArg = hook ? ' --activity-hook' : '';
    const releasePrefix = shellQuote(`${paths.targetRoot}/releases/`);
    return `#!/bin/sh
set -eu
: "\${CCSTATUSLINE_RELEASE_ROOT:?missing pinned release root}"
release_root=$CCSTATUSLINE_RELEASE_ROOT
case "$release_root" in
  ${releasePrefix}*) ;;
  *) exit 1 ;;
esac
export CCSTATUSLINE_CONFIG_DIR="$release_root/config"
exec "$release_root/bin/ccstatusline" --config "$release_root/config/settings.json"${extraArg} "$@"
`;
}

export function resolveDispatcherTools(): DispatcherTools {
    const sha256sumPath = commandPathOptional('sha256sum');
    const shasumPath = sha256sumPath ? null : commandPathOptional('shasum');
    const sha256Path = sha256sumPath ?? shasumPath;
    if (!sha256Path) {
        throw new Error('Required SHA-256 command is unavailable: sha256sum or shasum');
    }
    return {
        findPath: commandPath('find'),
        mktempPath: commandPath('mktemp'),
        sedPath: commandPath('sed'),
        sha256Args: sha256sumPath ? [] : ['-a', '256'],
        sha256Path
    };
}

function stableDispatcher(
    paths: DeploymentPaths,
    tools: DispatcherTools,
    hook: boolean
): string {
    if (!hook) {
        return buildStatuslineDispatcher({
            targetRoot: paths.targetRoot,
            ...tools
        });
    }
    const activePath = shellQuote(activeReleasePath(paths));
    const releasePrefix = shellQuote(`${paths.targetRoot}/releases/`);
    const sedPath = shellQuote(tools.sedPath);
    return `#!/bin/sh
set -u
release_id=$(${sedPath} -n '1p' ${activePath}) || exit 0
case "$release_id" in
  ''|*[!0-9a-f]*) exit 0 ;;
esac
[ "\${#release_id}" -eq 64 ] || exit 0
release_root=$(CDPATH= cd -- ${releasePrefix}"$release_id" && pwd -P) || exit 0
case "$release_root" in
  ${releasePrefix}*) ;;
  *) exit 0 ;;
esac
export CCSTATUSLINE_RELEASE_ROOT="$release_root"
status=0
"$release_root/bin/ccstatusline" --internal-supervise 2 \
  "$release_root/bin/ccstatusline-hook" "$@" || status=$?
case "$status" in
  124) exit 0 ;;
  *) exit "$status" ;;
esac
`;
}

function buildReleaseFiles(paths: DeploymentPaths, providers: JsonObject): ReleaseFile[] {
    return [
        {
            relativePath: 'bin/ccstatusline',
            content: fs.readFileSync(path.join(paths.validationRoot, 'dist', 'ccstatusline-local')),
            mode: 0o755
        },
        {
            relativePath: 'bin/ccstatusline-render',
            content: Buffer.from(releaseWrapper(paths, false)),
            mode: 0o755
        },
        {
            relativePath: 'bin/ccstatusline-hook',
            content: Buffer.from(releaseWrapper(paths, true)),
            mode: 0o755
        },
        {
            relativePath: 'config/settings.json',
            content: fs.readFileSync(
                path.join(paths.repoRoot, 'config', 'statusline', 'settings.json')
            ),
            mode: 0o644
        },
        {
            relativePath: 'config/providers.json',
            content: Buffer.from(`${JSON.stringify(providers, null, 2)}\n`),
            mode: 0o644
        },
        {
            relativePath: 'config/models.json',
            content: fs.readFileSync(
                path.join(paths.repoRoot, 'config', 'statusline', 'models.json')
            ),
            mode: 0o644
        },
        {
            relativePath: 'README.md',
            content: Buffer.from(
                'Immutable ccstatusline release. Activate through ../../active-release only.\n'
            ),
            mode: 0o644
        }
    ];
}

function buildReleasePlan(paths: DeploymentPaths, providers: JsonObject): ReleasePlan {
    const files = buildReleaseFiles(paths, providers);
    const fileHashes = Object.fromEntries(
        files.map(file => [file.relativePath, sha256(file.content)])
    );
    const manifestBase = {
        compatibleClaudeCode: '>=2.1.0',
        deploymentLayout: 'Claude config directory/statusline',
        files: fileHashes,
        optionalIntegrations: ['ccswitch-provider-discovery'],
        runtime: {
            architecture: process.arch,
            kind: 'bun-compiled',
            platform: process.platform
        },
        schemaVersion: 2,
        sourceCommit: run('git', ['rev-parse', 'HEAD'], { capture: true }),
        sourceDirty: run(
            'git',
            ['status', '--porcelain', '--untracked-files=normal'],
            { capture: true }
        ).length > 0
    };
    const releaseId = sha256(canonicalJson(manifestBase));
    return {
        files,
        manifest: {
            ...manifestBase,
            builtAt: new Date().toISOString(),
            releaseId
        },
        releaseId
    };
}

function validateReleaseDirectory(
    paths: DeploymentPaths,
    releasePath: string,
    plan: ReleasePlan
): boolean {
    const releasesRoot = path.resolve(paths.targetRoot, 'releases');
    const canonicalRelease = path.resolve(releasePath);
    if (path.dirname(canonicalRelease) !== releasesRoot
        || path.basename(canonicalRelease) !== plan.releaseId) {
        return false;
    }

    try {
        const manifest = readJson(path.join(canonicalRelease, 'manifest.json'));
        if (manifest.releaseId !== plan.releaseId
            || canonicalJson(manifest.files) !== canonicalJson(plan.manifest.files)) {
            return false;
        }
        return plan.files.every((file) => {
            const actual = sha256(fs.readFileSync(path.join(canonicalRelease, file.relativePath)));
            const expected = (plan.manifest.files as JsonObject)[file.relativePath];
            return actual === expected;
        });
    } catch {
        return false;
    }
}

function releaseMatchesActive(paths: DeploymentPaths, plan: ReleasePlan): boolean {
    const releaseId = readReleasePointer(activeReleasePath(paths));
    if (!releaseId || releaseId !== plan.releaseId) {
        return false;
    }
    return validateReleaseDirectory(
        paths,
        path.join(paths.targetRoot, 'releases', releaseId),
        plan
    );
}

async function stageRelease(paths: DeploymentPaths, plan: ReleasePlan): Promise<string> {
    const releasesRoot = path.join(paths.targetRoot, 'releases');
    const finalPath = path.join(releasesRoot, plan.releaseId);
    if (fs.existsSync(finalPath)) {
        if (validateReleaseDirectory(paths, finalPath, plan)) {
            return finalPath;
        }
        throw new Error(`Existing immutable release failed validation: ${finalPath}`);
    }

    await fs.promises.mkdir(releasesRoot, { recursive: true, mode: 0o755 });
    const stagePath = path.join(paths.targetRoot, `.staging-${plan.releaseId}-${process.pid}`);
    await fs.promises.rm(stagePath, { recursive: true, force: true });
    await fs.promises.mkdir(stagePath, { recursive: true, mode: 0o755 });
    try {
        for (const file of plan.files) {
            const target = path.join(stagePath, file.relativePath);
            await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
            await fs.promises.writeFile(target, file.content, { mode: file.mode });
        }
        await fs.promises.writeFile(
            path.join(stagePath, 'manifest.json'),
            `${JSON.stringify(plan.manifest, null, 2)}\n`,
            { encoding: 'utf8', mode: 0o644 }
        );
        for (const file of plan.files) {
            const actual = sha256(
                await fs.promises.readFile(path.join(stagePath, file.relativePath))
            );
            const expected = (plan.manifest.files as JsonObject)[file.relativePath];
            if (actual !== expected) {
                throw new Error(`Staged release hash mismatch: ${file.relativePath}`);
            }
        }
        await fs.promises.rename(stagePath, finalPath);
        return finalPath;
    } catch (error) {
        await fs.promises.rm(stagePath, { recursive: true, force: true });
        throw error;
    }
}

async function installStableDispatchers(
    paths: DeploymentPaths,
    tools: DispatcherTools
): Promise<void> {
    const binRoot = path.join(paths.targetRoot, 'bin');
    await fs.promises.mkdir(binRoot, { recursive: true, mode: 0o755 });
    for (const [name, hook] of [
        ['ccstatusline', false],
        ['ccstatusline-hook', true]
    ] as const) {
        const target = path.join(binRoot, name);
        await writeFileAtomic(target, stableDispatcher(paths, tools, hook), 0o755);
    }
}

function stableDispatchersMatch(
    paths: DeploymentPaths,
    tools: DispatcherTools
): boolean {
    return ([
        ['ccstatusline', false],
        ['ccstatusline-hook', true]
    ] as const).every(([name, hook]) => {
        try {
            return fs.readFileSync(path.join(paths.targetRoot, 'bin', name), 'utf8')
                === stableDispatcher(paths, tools, hook);
        } catch {
            return false;
        }
    });
}

function timestampSlug(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

async function createBackup(
    paths: DeploymentPaths,
    ccSwitchCommon: CCSwitchCommonResolution
): Promise<string> {
    const backupRoot = path.join(
        paths.backupRoot,
        `${timestampSlug()}-statusline-setup`
    );
    await fs.promises.mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const metadata: BackupMetadata = {
        activeRelease: readReleasePointer(activeReleasePath(paths)),
        createdAt: new Date().toISOString(),
        hadCcSwitchCommon: ccSwitchCommon.current !== null,
        hadSettings: fs.existsSync(paths.settingsPath),
        paths: {
            backupRoot: paths.backupRoot,
            settingsPath: paths.settingsPath,
            targetRoot: paths.targetRoot
        },
        previousRelease: readReleasePointer(previousReleasePath(paths)),
        retainUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        version: 5
    };
    if (metadata.hadSettings) {
        await fs.promises.copyFile(
            paths.settingsPath,
            path.join(backupRoot, 'claude-settings.json')
        );
        await fs.promises.chmod(path.join(backupRoot, 'claude-settings.json'), 0o600);
    }
    if (ccSwitchCommon.current) {
        await writeJsonAtomic(
            path.join(backupRoot, 'cc-switch-common.json'),
            ccSwitchCommon.current
        );
    }
    await writeJsonAtomic(path.join(backupRoot, 'metadata.json'), metadata);
    return backupRoot;
}

function resolveBackupRoot(paths: DeploymentPaths, argument: string): string {
    const backupRoot = path.resolve(argument);
    if (path.dirname(backupRoot) !== path.resolve(paths.backupRoot)
        || !path.basename(backupRoot).endsWith('-statusline-setup')) {
        throw new Error(
            `Rollback backup must be one statusline backup under ${paths.backupRoot}`
        );
    }
    return backupRoot;
}

async function restoreBackup(
    paths: DeploymentPaths,
    backupRoot: string,
    ccSwitchCommand?: string | null
): Promise<void> {
    const metadata = readJson(
        path.join(backupRoot, 'metadata.json')
    ) as unknown as BackupMetadata;
    if (![4, 5].includes(metadata.version)
        || path.resolve(metadata.paths.settingsPath) !== path.resolve(paths.settingsPath)
        || path.resolve(metadata.paths.targetRoot) !== path.resolve(paths.targetRoot)) {
        throw new Error(`Backup does not belong to this deployment: ${backupRoot}`);
    }

    const restoreCCSwitchCommand = metadata.hadCcSwitchCommon
        ? ccSwitchCommand ?? resolveCCSwitchCommand()
        : null;
    if (metadata.hadCcSwitchCommon && !restoreCCSwitchCommand) {
        throw new Error('CCSwitch is required to restore this deployment backup');
    }

    if (metadata.hadSettings) {
        const currentSettings = readJsonOrEmpty(paths.settingsPath);
        const backupSettings = readJson(path.join(backupRoot, 'claude-settings.json'));
        await writeJsonAtomic(
            paths.settingsPath,
            restoreManagedSettings(paths, currentSettings, backupSettings)
        );
    } else {
        await fs.promises.unlink(paths.settingsPath).catch(() => undefined);
    }
    await writeReleasePointer(activeReleasePath(paths), metadata.activeRelease);
    await writeReleasePointer(previousReleasePath(paths), metadata.previousRelease);
    if (metadata.hadCcSwitchCommon && restoreCCSwitchCommand) {
        const backupCommon = readJson(path.join(backupRoot, 'cc-switch-common.json'));
        const currentCommon = readCCSwitchCommon(restoreCCSwitchCommand);
        const expected = restoreManagedSettings(paths, currentCommon, backupCommon);
        writeCCSwitchCommon(restoreCCSwitchCommand, expected);
        const actual = readCCSwitchCommon(restoreCCSwitchCommand);
        const differences = collectJsonDifferencePaths(expected, actual);
        if (differences.length > 0) {
            throw new Error(
                `Restored CCSwitch common config differed at ${differences.join(', ')}`
            );
        }
    }
}

export function resolveProviderRegistry(
    mode: CCSwitchMode,
    baseline: JsonObject,
    discover: () => string
): ProviderResolution {
    if (mode === 'off') {
        return { registry: baseline, source: 'bundled' };
    }

    try {
        const discovered = parseProviderRegistry(discover());
        if (!discovered) {
            throw new Error('empty provider registry');
        }
        return {
            registry: mergeProviderRegistries(baseline, discovered),
            source: 'ccswitch'
        };
    } catch {
        if (mode === 'required') {
            throw new Error('CCSwitch provider discovery is required and unavailable');
        }
        return {
            registry: baseline,
            source: 'bundled',
            warning: 'CCSwitch provider discovery unavailable; using bundled provider registry'
        };
    }
}

function loadProviderRegistry(
    paths: DeploymentPaths,
    mode: CCSwitchMode
): ProviderResolution {
    const baseline = readJson(
        path.join(paths.repoRoot, 'config', 'statusline', 'providers.json')
    );
    return resolveProviderRegistry(mode, baseline, () => {
        const executable = resolveCCSwitchCommand();
        if (!executable) {
            throw new Error('cc-switch is unavailable');
        }
        return run(
            executable,
            ['-a', 'claude', 'provider', 'list'],
            { capture: true }
        );
    });
}

function resolveCCSwitchCommand(): string | null {
    const requestedCommand = process.env.CCSTATUSLINE_CCSWITCH_COMMAND ?? 'cc-switch';
    return commandPathOptional(requestedCommand);
}

function readCCSwitchCommon(command: string): JsonObject {
    return parseCCSwitchCommonConfig(run(
        command,
        ['-a', 'claude', 'config', 'common', 'show'],
        { capture: true }
    ));
}

function resolveCCSwitchConfigRoot(command: string): string {
    const output = run(command, ['config', 'path'], { capture: true });
    const match = /^Config dir:\s+(.+)$/m.exec(output);
    const configRoot = match?.[1]?.trim();
    if (!configRoot || !path.isAbsolute(configRoot) || !fs.existsSync(configRoot)) {
        throw new Error('CCSwitch config root could not be resolved safely');
    }
    return configRoot;
}

function writeCCSwitchCommon(command: string, commonConfig: JsonObject): void {
    const configRoot = resolveCCSwitchConfigRoot(command);
    const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-ccswitch-home-'));
    const commonConfigPath = path.join(sandboxHome, 'common-config.json');
    try {
        fs.writeFileSync(
            commonConfigPath,
            `${JSON.stringify(commonConfig)}\n`,
            { encoding: 'utf8', mode: 0o600 }
        );
        run(
            command,
            [
                '-a',
                'claude',
                'config',
                'common',
                'set',
                '--file',
                commonConfigPath
            ],
            {
                capture: true,
                env: commandEnvironment({
                    CC_SWITCH_CONFIG_DIR: configRoot,
                    CLAUDE_CONFIG_DIR: path.join(sandboxHome, '.claude'),
                    HOME: sandboxHome,
                    USERPROFILE: sandboxHome,
                    XDG_CONFIG_HOME: path.join(sandboxHome, '.config')
                })
            }
        );
    } finally {
        fs.rmSync(sandboxHome, { recursive: true, force: true });
    }
}

function loadCCSwitchCommon(
    paths: DeploymentPaths,
    mode: CCSwitchMode,
    providerSource: ProviderResolution['source']
): CCSwitchCommonResolution {
    if (mode === 'off' || providerSource !== 'ccswitch') {
        return { command: null, current: null, next: null };
    }

    const command = resolveCCSwitchCommand();
    try {
        if (!command) {
            throw new Error('cc-switch is unavailable');
        }
        const current = readCCSwitchCommon(command);
        return {
            command,
            current,
            next: mergeManagedSettings(paths, current)
        };
    } catch {
        if (mode === 'required') {
            throw new Error('CCSwitch common config is required and unavailable');
        }
        return {
            command: null,
            current: null,
            next: null,
            warning: 'CCSwitch common config unavailable; managed launch settings were not synchronized'
        };
    }
}

export function syncCCSwitchCommon(
    paths: DeploymentPaths,
    resolution: CCSwitchCommonResolution
): void {
    if (!resolution.command || !resolution.next) {
        return;
    }
    const current = readCCSwitchCommon(resolution.command);
    const next = mergeManagedSettings(paths, current);
    if (semanticEqual(current, next)) {
        return;
    }
    writeCCSwitchCommon(resolution.command, next);
    const actual = readCCSwitchCommon(resolution.command);
    const differences = collectJsonDifferencePaths(next, actual);
    if (differences.length > 0) {
        throw new Error(
            `CCSwitch common config read-back differed at ${differences.join(', ')}`
        );
    }
}

function semanticEqual(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

function validateManagedPatchPaths(paths: DeploymentPaths): void {
    const serialized = JSON.stringify(managedPatch(paths));
    if (!serialized.includes(`${paths.targetRoot}/bin/ccstatusline`)
        || !serialized.includes(`${paths.targetRoot}/bin/ccstatusline-hook`)
        || serialized.includes('/ccswitch-statusline')) {
        throw new Error('Managed settings patch contains an invalid statusline command');
    }
}

function preflight(paths: DeploymentPaths): DispatcherTools {
    for (const filePath of [
        path.join(paths.repoRoot, 'config', 'statusline', 'settings.json'),
        path.join(paths.repoRoot, 'config', 'statusline', 'models.json'),
        path.join(paths.repoRoot, 'config', 'statusline', 'providers.json')
    ]) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Required path is missing: ${filePath}`);
        }
    }
    commandPath('bun');
    commandPath('node');
    const tools = resolveDispatcherTools();
    validateManagedPatchPaths(paths);
    if (sourceTreeDigest(paths.validationRoot) !== sourceTreeDigest(paths.repoRoot)) {
        throw new Error(`Validation root does not match repository source: ${paths.validationRoot}`);
    }
    return tools;
}

function smokeTranscriptRecords(): string {
    const records = [
        {
            message: { content: 'statusline deployment smoke', role: 'user' },
            origin: { kind: 'human', source: 'typed' },
            timestamp: '2026-07-30T00:00:00.000Z',
            type: 'user'
        },
        {
            message: {
                content: [{ id: 'smoke-tool', input: {}, name: 'Read', type: 'tool_use' }],
                model: 'gpt-5.6-sol',
                role: 'assistant'
            },
            timestamp: '2026-07-30T00:01:00.000Z',
            type: 'assistant'
        }
    ];
    return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
}

function verifyStatuslineSmoke(
    paths: DeploymentPaths,
    command: string,
    releaseRoot?: string,
    expectLastGoodCache = false
): string {
    const home = process.env.HOME;
    if (!home) {
        throw new Error('HOME is required for statusline smoke validation');
    }
    const cacheRoot = path.join(home, '.cache');
    fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
    const smokeRoot = fs.mkdtempSync(path.join(cacheRoot, 'ccstatusline-deploy-smoke-'));
    const transcriptPath = path.join(smokeRoot, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, smokeTranscriptRecords(), { encoding: 'utf8', mode: 0o600 });
    const payload = {
        context_window: {
            context_window_size: 1_000_000,
            current_usage: {
                input_tokens: 58_000,
                output_tokens: 1_000
            }
        },
        cost: {
            total_cost_usd: 1.23,
            total_duration_ms: 60_000
        },
        cwd: paths.repoRoot,
        effort: { level: 'high' },
        model: { id: 'gpt-5.6-sol(high)[1m]' },
        session_id: 'ccstatusline-deploy-smoke',
        transcript_path: transcriptPath,
        version: '2.1.220',
        workspace: { current_dir: paths.repoRoot }
    };
    try {
        const output = run(command, [], {
            capture: true,
            cwd: paths.repoRoot,
            env: commandEnvironment({
                ANTHROPIC_BASE_URL: 'http://localhost:8317',
                CCSTATUSLINE_WIDTH: '240',
                CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80',
                CLAUDE_CODE_AUTO_COMPACT_WINDOW: '64000',
                ...(releaseRoot ? { CCSTATUSLINE_RELEASE_ROOT: releaseRoot } : {})
            }),
            input: `${JSON.stringify(payload)}\n`,
            trimOutput: false
        });
        const required = [
            'Provider',
            'ClipProxyAPI',
            'Model',
            'GPT 5.6 Sol',
            'Effort',
            'high',
            `cwd: ${paths.repoRoot}`,
            'Context',
            'Compact',
            'Tools 1 last turn',
            'Session',
            'Cost'
        ];
        const normalizedOutput = output
            .replace(/\x1b\[[0-9;]*m/g, '')
            .replace(/\u00a0/g, ' ');
        const normalizedLines = normalizedOutput.split('\n').filter(Boolean);
        const missing = required.filter(value => !normalizedOutput.includes(value));
        if (normalizedLines.length !== 4
            || missing.length > 0
            || !output.includes('\x1b[')
            || normalizedOutput.includes('cwd: ...')) {
            throw new Error(
                'Statusline smoke output did not preserve the required four-line UI fields '
                + `(lines=${normalizedLines.length}, missing=${missing.join(', ') || 'none'})`
            );
        }
        if (expectLastGoodCache) {
            const cacheKey = sha256('ccstatusline-deploy-smoke|');
            const cachePath = path.join(
                process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'),
                'ccstatusline',
                'last-good',
                `${cacheKey}.ansi`
            );
            try {
                if (fs.readFileSync(cachePath, 'utf8') !== output
                    || (fs.statSync(cachePath).mode & 0o777) !== 0o600) {
                    throw new Error(
                        'Stable dispatcher last-known-good cache did not match smoke output'
                    );
                }
            } finally {
                awaitableUnlink(cachePath);
            }
        }
        return output;
    } finally {
        fs.rmSync(smokeRoot, { recursive: true, force: true });
    }
}

function awaitableUnlink(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

function verifyHookSmoke(command: string, cwd: string): void {
    const sessionId = `ccstatusline-deployment-${process.pid}`;
    const skillsFile = getSkillsFilePath(sessionId);
    const events = [
        { hook_event_name: 'SessionStart', session_id: sessionId },
        {
            hook_event_name: 'PreToolUse',
            session_id: sessionId,
            tool_input: { skill: 'deployment-smoke' },
            tool_name: 'Skill'
        },
        { hook_event_name: 'SessionEnd', session_id: sessionId }
    ];
    try {
        for (const event of events) {
            const result = spawnSync(command, [], {
                cwd,
                encoding: 'utf8',
                env: commandEnvironment(),
                input: `${JSON.stringify(event)}\n`
            });
            if (result.status !== 0 || result.stdout !== '' || result.stderr !== '') {
                throw new Error(`Managed hook smoke failed for ${event.hook_event_name}`);
            }
        }
        const skillsLog = fs.readFileSync(skillsFile, 'utf8');
        if (!skillsLog.includes('"skill":"deployment-smoke"')) {
            throw new Error('Managed hook smoke did not record the Skill invocation');
        }
    } finally {
        awaitableUnlink(skillsFile);
    }
}

function verifyApplied(
    paths: DeploymentPaths,
    expectedSettings: JsonObject,
    plan: ReleasePlan
): void {
    const actualSettings = readJson(paths.settingsPath);
    const settingsDifferences = collectJsonDifferencePaths(expectedSettings, actualSettings);
    if (settingsDifferences.length > 0) {
        throw new Error(
            `Claude settings read-back differed after apply at ${settingsDifferences.join(', ')}`
        );
    }
    if (readReleasePointer(activeReleasePath(paths)) !== plan.releaseId) {
        throw new Error('Active release pointer read-back differed after apply');
    }
    const releasePath = path.join(paths.targetRoot, 'releases', plan.releaseId);
    if (!validateReleaseDirectory(paths, releasePath, plan)) {
        throw new Error('Activated release failed manifest validation');
    }
}

async function applyDeployment(options: CliOptions): Promise<void> {
    const paths = resolveDeploymentPaths();
    const dispatcherTools = preflight(paths);
    const providerResolution = loadProviderRegistry(paths, options.ccSwitchMode);
    if (providerResolution.warning) {
        console.warn(providerResolution.warning);
    }
    const ccSwitchCommon = loadCCSwitchCommon(
        paths,
        options.ccSwitchMode,
        providerResolution.source
    );
    if (ccSwitchCommon.warning) {
        console.warn(ccSwitchCommon.warning);
    }

    run('bun', ['run', 'lint'], { cwd: paths.validationRoot, capture: true });
    run('bun', ['test'], { cwd: paths.validationRoot, capture: true });
    run('bun', ['run', 'build'], { cwd: paths.validationRoot, capture: true });
    run(
        'bun',
        ['run', 'build:local-runtime'],
        { cwd: paths.validationRoot, capture: true }
    );
    console.log('validation ok: lint, tests, distribution build, local runtime build');

    const plan = buildReleasePlan(paths, providerResolution.registry);
    const settings = readJsonOrEmpty(paths.settingsPath);
    const nextSettings = mergeManagedSettings(paths, settings);
    const noArtifactChange = releaseMatchesActive(paths, plan);
    const noConfigurationChange = semanticEqual(settings, nextSettings);
    const noInfrastructureChange = stableDispatchersMatch(paths, dispatcherTools);
    const noCCSwitchCommonChange = !ccSwitchCommon.current
        || !ccSwitchCommon.next
        || semanticEqual(ccSwitchCommon.current, ccSwitchCommon.next);
    if (noArtifactChange && noConfigurationChange && noInfrastructureChange
        && noCCSwitchCommonChange) {
        console.log(
            `no-op release=${plan.releaseId} ccswitch=${providerResolution.source}`
        );
        return;
    }

    const backupRoot = await createBackup(paths, ccSwitchCommon);
    try {
        const releasePath = await stageRelease(paths, plan);
        verifyStatuslineSmoke(
            paths,
            path.join(releasePath, 'bin', 'ccstatusline-render'),
            releasePath
        );
        await installStableDispatchers(paths, dispatcherTools);
        const oldActive = readReleasePointer(activeReleasePath(paths));
        await writeReleasePointer(previousReleasePath(paths), oldActive);
        await writeReleasePointer(activeReleasePath(paths), plan.releaseId);

        const activationSettings = mergeManagedSettings(
            paths,
            readJsonOrEmpty(paths.settingsPath)
        );
        await writeJsonAtomic(paths.settingsPath, activationSettings);
        syncCCSwitchCommon(paths, ccSwitchCommon);
        verifyApplied(paths, activationSettings, plan);

        verifyStatuslineSmoke(
            paths,
            path.join(paths.targetRoot, 'bin', 'ccstatusline'),
            undefined,
            true
        );
        verifyHookSmoke(
            path.join(paths.targetRoot, 'bin', 'ccstatusline-hook'),
            paths.repoRoot
        );
        console.log(
            `applied release=${plan.releaseId} backup=${backupRoot} `
            + `ccswitch=${providerResolution.source}`
        );
    } catch (error) {
        await restoreBackup(paths, backupRoot, ccSwitchCommon.command);
        throw error;
    }
}

function printPlan(options: CliOptions): void {
    const paths = resolveDeploymentPaths();
    const dispatcherTools = preflight(paths);
    const providerResolution = loadProviderRegistry(paths, options.ccSwitchMode);
    const ccSwitchCommon = loadCCSwitchCommon(
        paths,
        options.ccSwitchMode,
        providerResolution.source
    );
    const settings = readJsonOrEmpty(paths.settingsPath);
    const nextSettings = mergeManagedSettings(paths, settings);
    const changedSettingsKeys = Object.keys(nextSettings)
        .filter(key => !semanticEqual(settings[key], nextSettings[key]));
    console.log(JSON.stringify({
        backupRoot: paths.backupRoot,
        ccSwitchMode: options.ccSwitchMode,
        ccSwitchCommonChanged: Boolean(
            ccSwitchCommon.current
            && ccSwitchCommon.next
            && !semanticEqual(ccSwitchCommon.current, ccSwitchCommon.next)
        ),
        ccSwitchCommonWarning: ccSwitchCommon.warning ?? null,
        ccSwitchSource: providerResolution.source,
        ccSwitchWarning: providerResolution.warning ?? null,
        changedSettingsKeys,
        configuredSettingsPath: paths.configuredSettingsPath,
        settingsAuthority: paths.settingsPath,
        stableDispatchersChanged: !stableDispatchersMatch(paths, dispatcherTools),
        stateChange: false,
        targetRoot: paths.targetRoot,
        validation: [
            'bun run lint',
            'bun test',
            'bun run build',
            'bun run build:local-runtime'
        ],
        validationRoot: paths.validationRoot
    }, null, 2));
}

function parseCliArguments(args: string[], environment: NodeJS.ProcessEnv): CliOptions {
    const modeArgument = args.find(argument => argument.startsWith('--ccswitch='));
    const requestedMode = modeArgument
        ? modeArgument.slice('--ccswitch='.length)
        : environment.CCSTATUSLINE_CCSWITCH_MODE ?? 'auto';
    if (!['auto', 'off', 'required'].includes(requestedMode)) {
        throw new Error(`Invalid CCSwitch mode: ${requestedMode}`);
    }
    const positional = args.filter(argument => !argument.startsWith('--ccswitch='));
    const [action, backupPath] = positional;
    if (action === '--check' || action === '--dry-run') {
        return { action: 'check', ccSwitchMode: requestedMode as CCSwitchMode };
    }
    if (action === '--apply') {
        return { action: 'apply', ccSwitchMode: requestedMode as CCSwitchMode };
    }
    if (action === '--rollback' && backupPath) {
        return {
            action: 'rollback',
            backupPath,
            ccSwitchMode: requestedMode as CCSwitchMode
        };
    }
    throw new Error(
        'Usage: bun run scripts/deploy-local.ts '
        + '--check|--dry-run|--apply|--rollback <backup> '
        + '[--ccswitch=auto|off|required]'
    );
}

async function main(): Promise<void> {
    const options = parseCliArguments(process.argv.slice(2), process.env);
    if (options.action === 'check') {
        printPlan(options);
        return;
    }
    if (options.action === 'apply') {
        await applyDeployment(options);
        return;
    }
    const paths = resolveDeploymentPaths();
    preflight(paths);
    const backupRoot = resolveBackupRoot(paths, options.backupPath ?? '');
    await restoreBackup(paths, backupRoot, resolveCCSwitchCommand());
    console.log(`rolled-back backup=${backupRoot}`);
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`deploy-local: ${message}`);
        process.exitCode = 1;
    });
}
