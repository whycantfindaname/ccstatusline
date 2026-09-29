export type JsonObject = Record<string, unknown>;

export function runtimeBinaryName(): string {
    return process.platform === 'win32' ? 'ccstatusline.exe' : 'ccstatusline';
}

export interface ManagedActivityHook {
    event: string;
    matcher?: string;
}

function isJsonObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function collectJsonDifferencePaths(
    left: unknown,
    right: unknown,
    currentPath = '$'
): string[] {
    if (Object.is(left, right)) {
        return [];
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return [`${currentPath}.length`];
        }
        return left.flatMap((value, index) => collectJsonDifferencePaths(
            value,
            right[index],
            `${currentPath}[${index}]`
        ));
    }
    if (isJsonObject(left) && isJsonObject(right)) {
        const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
        return keys.flatMap(key => collectJsonDifferencePaths(
            left[key],
            right[key],
            `${currentPath}.${key}`
        ));
    }
    return [currentPath];
}

export function parseCCSwitchCommonConfig(output: string): JsonObject {
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) {
        throw new Error('CCSwitch common config output did not contain a JSON object');
    }
    const parsed = JSON.parse(output.slice(jsonStart)) as unknown;
    if (!isJsonObject(parsed)) {
        throw new Error('CCSwitch common config output was not a JSON object');
    }
    return parsed;
}

export function buildManagedPatch(
    targetRoot: string,
    activityHooks: ManagedActivityHook[] = []
): JsonObject {
    const statuslineCommand = `${shellPath(targetRoot)}/bin/ccstatusline`;
    const hookCommand = `${shellPath(targetRoot)}/bin/ccstatusline-hook`;
    const hooks: JsonObject = {};
    const seen = new Set<string>();
    const hookDefs: ManagedActivityHook[] = [
        { event: 'SessionStart', matcher: '' },
        { event: 'SubagentStart', matcher: '' },
        { event: 'SubagentStop', matcher: '' },
        { event: 'SessionEnd', matcher: '' },
        ...activityHooks
    ];

    for (const hookDef of hookDefs) {
        const key = `${hookDef.event}:${hookDef.matcher ?? ''}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const hook: JsonObject = {
            hooks: [{
                type: 'command',
                command: hookCommand,
                timeout: process.platform === 'win32' && hookDef.event === 'SessionEnd' ? 10 : 2
            }]
        };
        if (hookDef.matcher !== undefined) {
            hook.matcher = hookDef.matcher;
        }
        const eventHooks = hooks[hookDef.event] as JsonObject[] | undefined;
        if (eventHooks) {
            eventHooks.push(hook);
        } else {
            hooks[hookDef.event] = [hook];
        }
    }

    return {
        statusLine: {
            type: 'command',
            command: statuslineCommand,
            padding: 0,
            refreshInterval: 5
        },
        subagentStatusLine: {
            type: 'command',
            command: `${statuslineCommand} --subagent`
        },
        hooks
    };
}

function isManagedHookCommand(value: unknown): boolean {
    if (!isJsonObject(value) || typeof value.command !== 'string') {
        return false;
    }
    const token = /^(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(value.command.trim());
    const executable = token?.[1] ?? token?.[2] ?? token?.[3];
    const basename = executable?.replace(/\\/g, '/').split('/').pop();
    return basename === 'ccstatusline-hook' || basename === 'ccswitch-statusline-hook';
}

function filterHookEntry(value: unknown, managed: boolean): unknown {
    if (!isJsonObject(value) || !Array.isArray(value.hooks)) {
        return managed ? null : value;
    }
    const hooks = value.hooks.filter(hook => isManagedHookCommand(hook) === managed);
    return hooks.length > 0 ? { ...value, hooks } : null;
}

function filterHookEntries(entries: unknown[], managed: boolean): unknown[] {
    return entries.flatMap((entry) => {
        const filtered = filterHookEntry(entry, managed);
        return filtered === null ? [] : [filtered];
    });
}

export function mergeManagedSettings(source: JsonObject, patch: JsonObject): JsonObject {
    const sourceHooks = source.hooks && typeof source.hooks === 'object' && !Array.isArray(source.hooks)
        ? source.hooks as JsonObject
        : {};
    const patchHooks = patch.hooks as JsonObject;
    const mergedHooks: JsonObject = {};

    for (const [event, entries] of Object.entries(sourceHooks)) {
        if (!Array.isArray(entries)) {
            mergedHooks[event] = entries;
            continue;
        }
        const unmanagedEntries = filterHookEntries(entries, false);
        if (unmanagedEntries.length > 0) {
            mergedHooks[event] = unmanagedEntries;
        }
    }

    for (const [event, managedValue] of Object.entries(patchHooks)) {
        const existing: unknown[] = Array.isArray(mergedHooks[event])
            ? Array.from(mergedHooks[event])
            : [];
        const managedEntries: unknown[] = Array.isArray(managedValue)
            ? Array.from(managedValue)
            : [];
        mergedHooks[event] = [
            ...existing,
            ...managedEntries
        ];
    }

    return {
        ...source,
        statusLine: patch.statusLine,
        subagentStatusLine: patch.subagentStatusLine,
        hooks: mergedHooks
    };
}

export function restoreManagedSettings(
    current: JsonObject,
    backup: JsonObject,
    patch: JsonObject
): JsonObject {
    const currentHooks = isJsonObject(current.hooks) ? current.hooks : {};
    const backupHooks = isJsonObject(backup.hooks) ? backup.hooks : {};
    const patchHooks = isJsonObject(patch.hooks) ? patch.hooks : {};
    const restoredHooks: JsonObject = {};
    const hookEvents = new Set([
        ...Object.keys(currentHooks),
        ...Object.keys(backupHooks),
        ...Object.keys(patchHooks)
    ]);

    for (const event of hookEvents) {
        const currentEntries: unknown[] = Array.isArray(currentHooks[event])
            ? Array.from(currentHooks[event] as unknown[])
            : [];
        const backupEntries: unknown[] = Array.isArray(backupHooks[event])
            ? Array.from(backupHooks[event] as unknown[])
            : [];
        if (!Array.isArray(currentHooks[event]) && currentHooks[event] !== undefined) {
            restoredHooks[event] = currentHooks[event];
            continue;
        }
        const restoredEntries: unknown[] = [
            ...filterHookEntries(currentEntries, false),
            ...filterHookEntries(backupEntries, true)
        ];
        if (restoredEntries.length > 0) {
            restoredHooks[event] = restoredEntries;
        } else {
            Reflect.deleteProperty(restoredHooks, event);
        }
    }

    const restored: JsonObject = {
        ...current,
        hooks: restoredHooks
    };
    for (const key of ['statusLine', 'subagentStatusLine']) {
        if (Object.prototype.hasOwnProperty.call(backup, key)) {
            restored[key] = backup[key];
        } else {
            Reflect.deleteProperty(restored, key);
        }
    }
    if (Object.keys(restoredHooks).length === 0) {
        delete restored.hooks;
    }
    return restored;
}

export interface StatuslineDispatcherOptions {
    coldTimeout?: string;
    findPath: string;
    mktempPath: string;
    shPath?: string;
    sedPath: string;
    sha256Args?: readonly string[];
    sha256Path: string;
    targetRoot: string;
    warmTimeout?: string;
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellPath(value: string): string {
    return process.platform === 'win32' ? value.replaceAll('\\', '/') : value;
}

function checkedDuration(value: string, name: string): string {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
    if (!match) {
        throw new Error(`${name} must be a timeout duration in seconds`);
    }
    return value.slice(0, -1);
}

export function buildStatuslineDispatcher(options: StatuslineDispatcherOptions): string {
    const coldTimeout = checkedDuration(options.coldTimeout ?? '4s', 'coldTimeout');
    const warmTimeout = checkedDuration(options.warmTimeout ?? '1s', 'warmTimeout');
    const activeReleasePath = shellQuote(`${shellPath(options.targetRoot)}/active-release`);
    const releasesPath = shellQuote(`${shellPath(options.targetRoot)}/releases`);
    const sedPath = shellQuote(shellPath(options.sedPath));
    const sha256Command = [options.sha256Path, ...(options.sha256Args ?? [])]
        .map(shellPath)
        .map(shellQuote)
        .join(' ');
    const findPath = shellQuote(shellPath(options.findPath));
    const mktempPath = shellQuote(shellPath(options.mktempPath));
    const rendererCommand = options.shPath
        ? `${shellQuote(shellPath(options.shPath))} "$release_root/bin/ccstatusline-render"`
        : '"$runtime_binary" --config "$release_root/config/settings.json"';

    return `#!/bin/sh
set -u
umask 077
release_id=''
IFS= read -r release_id 2>/dev/null < ${activeReleasePath} || [ -n "$release_id" ] || {
  printf '%s\\n' 'Statusline refreshing; release pointer unavailable'
  exit 0
}
case "$release_id" in
  ''|*[!0-9a-f]*)
    printf '%s\\n' 'Statusline refreshing; invalid release pointer'
    exit 0
    ;;
esac
if [ "\${#release_id}" -ne 64 ]; then
  printf '%s\\n' 'Statusline refreshing; invalid release pointer'
  exit 0
fi
original_cwd=$PWD
CDPATH= cd -P -- ${releasesPath} || {
  printf '%s\\n' 'Statusline refreshing; release directory unavailable'
  exit 0
}
releases_root=$PWD
CDPATH= cd -P -- "$releases_root/$release_id" || {
  printf '%s\\n' 'Statusline refreshing; release unavailable'
  exit 0
}
release_root=$PWD
case "$release_root" in
  "$releases_root"/*) ;;
  *)
    printf '%s\\n' 'Statusline refreshing; invalid release'
    exit 0
    ;;
esac
CDPATH= cd -P -- "$original_cwd" || {
  printf '%s\\n' 'Statusline refreshing; caller directory unavailable'
  exit 0
}
export CCSTATUSLINE_RELEASE_ROOT="$release_root"
export CCSTATUSLINE_CONFIG_DIR="$release_root/config"
runtime_binary="$release_root/bin/${runtimeBinaryName()}"
if [ ! -x "$runtime_binary" ]; then
  runtime_binary="$release_root/bin/ccstatusline"
fi
[ -x "$runtime_binary" ] || {
  printf '%s\\n' 'Statusline refreshing; runtime unavailable'
  exit 0
}

if [ -z "\${HOME:-}" ]; then
  printf '%s\\n' 'Statusline refreshing; HOME unavailable'
  exit 0
fi
cache_dir="\${XDG_CACHE_HOME:-\${HOME}/.cache}/ccstatusline/last-good"
cache_tail="$cache_dir"
cache_dir=''
while :; do
  case "$cache_tail" in
    *\\\\*)
      cache_dir="$cache_dir\${cache_tail%%\\\\*}/"
      cache_tail="\${cache_tail#*\\\\}"
      ;;
    *) cache_dir="$cache_dir$cache_tail"; break ;;
  esac
done
case "$cache_dir" in
  /*|[A-Za-z]:/*) ;;
  *)
    printf '%s\\n' 'Statusline refreshing; cache path unavailable'
    exit 0
    ;;
esac
if [ ! -d "$cache_dir" ] && ! mkdir -p -- "$cache_dir"; then
  printf '%s\\n' 'Statusline refreshing; cache unavailable'
  exit 0
fi
payload_file=$(${mktempPath} "$cache_dir/.payload.XXXXXX") || {
  printf '%s\\n' 'Statusline refreshing; payload staging unavailable'
  exit 0
}
output_file=$(${mktempPath} "$cache_dir/.output.XXXXXX") || {
  rm -f -- "$payload_file"
  printf '%s\\n' 'Statusline refreshing; output staging unavailable'
  exit 0
}
cleanup() {
  rm -f -- "$payload_file" "$output_file"
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM
cat > "$payload_file" || exit 0

session_id=$(${sedPath} -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([A-Za-z0-9._-]*\\)".*/\\1/p' "$payload_file")
case "$session_id" in
  ''|*[!A-Za-z0-9._-]*) session_id="parent-\${PPID:-unknown}" ;;
esac
session_key=$(printf '%s|%s' "$session_id" "$*" | ${sha256Command})
session_key=\${session_key%% *}
cache_file="$cache_dir/$session_key.ansi"

duration=${shellQuote(warmTimeout)}
if [ ! -s "$cache_file" ]; then
  duration=${shellQuote(coldTimeout)}
fi
status=0
    "$runtime_binary" --internal-supervise "$duration" \
      ${rendererCommand} "$@" \
  < "$payload_file" > "$output_file" || status=$?

if [ "$status" -eq 0 ] && [ -s "$output_file" ]; then
  if mv -f -- "$output_file" "$cache_file"; then
    cat "$cache_file"
  else
    cat "$output_file"
  fi
  ${findPath} "$cache_dir" -mindepth 1 -maxdepth 1 -type f \
    -name '*.ansi' -mmin +10080 -delete >/dev/null 2>&1 || true
  exit 0
fi

if [ -s "$cache_file" ]; then
  cat "$cache_file"
  exit 0
fi
printf '\\033[0m%s\\n' 'Statusline refreshing; retrying on next refresh'
exit 0
`;
}

export function parseProviderRegistry(output: string): JsonObject | null {
    const providers: JsonObject[] = [];
    for (const line of output.split('\n')) {
        if (!line.includes('│') || line.includes('ID') || line.includes('─') || line.includes('═')) {
            continue;
        }
        const cells = line
            .split(/[│┆]/)
            .map(cell => cell.replace('✓', '').trim())
            .filter(Boolean);
        if (cells.length < 3) {
            continue;
        }
        const [id, displayName, apiUrl] = cells;
        if (!id || !displayName || !apiUrl) {
            continue;
        }
        const entry: JsonObject = { id, displayName };
        if (apiUrl !== 'N/A') {
            try {
                const url = new URL(apiUrl);
                entry.origins = [url.origin.toLowerCase()];
                entry.hostnames = [url.hostname.toLowerCase()];
            } catch {
                continue;
            }
        } else {
            entry.origins = [];
        }
        providers.push(entry);
    }
    return providers.length > 0 ? { version: 1, providers } : null;
}

function providerKey(value: JsonObject): string {
    if (typeof value.id === 'string' && value.id.length > 0) {
        return `id:${value.id.toLowerCase()}`;
    }
    if (typeof value.displayName === 'string' && value.displayName.length > 0) {
        return `name:${value.displayName.toLowerCase()}`;
    }
    return `value:${JSON.stringify(value)}`;
}

export function mergeProviderRegistries(
    baseline: JsonObject,
    discovered: JsonObject
): JsonObject {
    const merged = new Map<string, JsonObject>();
    const baselineProviders: unknown[] = Array.isArray(baseline.providers)
        ? Array.from(baseline.providers as unknown[])
        : [];
    const discoveredProviders: unknown[] = Array.isArray(discovered.providers)
        ? Array.from(discovered.providers as unknown[])
        : [];
    for (const provider of [...baselineProviders, ...discoveredProviders]) {
        if (isJsonObject(provider)) {
            merged.set(providerKey(provider), provider);
        }
    }
    return {
        version: 1,
        providers: Array.from(merged.values())
    };
}
