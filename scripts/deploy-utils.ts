export type JsonObject = Record<string, unknown>;

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

export function buildManagedPatch(targetRoot: string): JsonObject {
    const statuslineCommand = `${targetRoot}/bin/ccstatusline`;
    const hookCommand = `${targetRoot}/bin/ccstatusline-hook`;
    const hook = {
        matcher: '',
        hooks: [{
            type: 'command',
            command: hookCommand,
            timeout: 2
        }]
    };
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
        hooks: {
            SessionStart: [hook],
            SubagentStart: [hook],
            SubagentStop: [hook],
            SessionEnd: [hook]
        }
    };
}

function isManagedHookEntry(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const hooks = (value as JsonObject).hooks;
    if (!Array.isArray(hooks)) {
        return false;
    }
    return hooks.some((hook) => {
        if (!hook || typeof hook !== 'object') {
            return false;
        }
        const command = (hook as JsonObject).command;
        return typeof command === 'string'
            && (
                command.includes('/ccstatusline-hook')
                || command.includes('/ccswitch-statusline-hook')
            );
    });
}

export function mergeManagedSettings(source: JsonObject, patch: JsonObject): JsonObject {
    const sourceHooks = source.hooks && typeof source.hooks === 'object' && !Array.isArray(source.hooks)
        ? source.hooks as JsonObject
        : {};
    const patchHooks = patch.hooks as JsonObject;
    const mergedHooks: JsonObject = { ...sourceHooks };

    for (const [event, managedValue] of Object.entries(patchHooks)) {
        const existing: unknown[] = Array.isArray(sourceHooks[event])
            ? Array.from(sourceHooks[event])
            : [];
        const managedEntries: unknown[] = Array.isArray(managedValue)
            ? Array.from(managedValue)
            : [];
        mergedHooks[event] = [
            ...existing.filter(entry => !isManagedHookEntry(entry)),
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
    const restoredHooks: JsonObject = { ...currentHooks };

    for (const event of Object.keys(patchHooks)) {
        const currentEntries: unknown[] = Array.isArray(currentHooks[event])
            ? Array.from(currentHooks[event] as unknown[])
            : [];
        const backupEntries: unknown[] = Array.isArray(backupHooks[event])
            ? Array.from(backupHooks[event] as unknown[])
            : [];
        const restoredEntries = [
            ...currentEntries.filter(entry => !isManagedHookEntry(entry)),
            ...backupEntries.filter(isManagedHookEntry)
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
    sedPath: string;
    sha256Path: string;
    targetRoot: string;
    timeoutPath: string;
    warmTimeout?: string;
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function checkedDuration(value: string, name: string): string {
    if (!/^(?:\d+(?:\.\d+)?)s$/.test(value)) {
        throw new Error(`${name} must be a timeout duration in seconds`);
    }
    return value;
}

export function buildStatuslineDispatcher(options: StatuslineDispatcherOptions): string {
    const coldTimeout = checkedDuration(options.coldTimeout ?? '4s', 'coldTimeout');
    const warmTimeout = checkedDuration(options.warmTimeout ?? '1s', 'warmTimeout');
    const activeReleasePath = shellQuote(`${options.targetRoot}/active-release`);
    const releasePrefix = shellQuote(`${options.targetRoot}/releases/`);
    const timeoutPath = shellQuote(options.timeoutPath);
    const sedPath = shellQuote(options.sedPath);
    const sha256Path = shellQuote(options.sha256Path);
    const findPath = shellQuote(options.findPath);
    const mktempPath = shellQuote(options.mktempPath);

    return `#!/bin/sh
set -u
umask 077
release_id=$(${sedPath} -n '1p' ${activeReleasePath}) || {
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
release_root=$(CDPATH= cd -- ${releasePrefix}"$release_id" && pwd -P) || {
  printf '%s\\n' 'Statusline refreshing; release unavailable'
  exit 0
}
case "$release_root" in
  ${releasePrefix}*) ;;
  *)
    printf '%s\\n' 'Statusline refreshing; invalid release'
    exit 0
    ;;
esac
export CCSTATUSLINE_RELEASE_ROOT="$release_root"

if [ -z "\${HOME:-}" ]; then
  printf '%s\\n' 'Statusline refreshing; HOME unavailable'
  exit 0
fi
cache_dir="\${XDG_CACHE_HOME:-\${HOME}/.cache}/ccstatusline/last-good"
case "$cache_dir" in
  /*) ;;
  *)
    printf '%s\\n' 'Statusline refreshing; cache path unavailable'
    exit 0
    ;;
esac
if ! mkdir -p -- "$cache_dir"; then
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
cache_tmp=''
cleanup() {
  rm -f -- "$payload_file" "$output_file"
  if [ -n "$cache_tmp" ]; then
    rm -f -- "$cache_tmp"
  fi
}
trap cleanup EXIT HUP INT TERM
cat > "$payload_file" || exit 0

session_id=$(${sedPath} -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([A-Za-z0-9._-]*\\)".*/\\1/p' "$payload_file")
case "$session_id" in
  ''|*[!A-Za-z0-9._-]*) session_id="parent-\${PPID:-unknown}" ;;
esac
session_key=$(printf '%s|%s' "$session_id" "$*" | ${sha256Path})
session_key=\${session_key%% *}
cache_file="$cache_dir/$session_key.ansi"

duration=${shellQuote(warmTimeout)}
if [ ! -s "$cache_file" ]; then
  duration=${shellQuote(coldTimeout)}
fi
status=0
${timeoutPath} --kill-after=0.1s "$duration" \
  "$release_root/bin/ccstatusline-render" "$@" \
  < "$payload_file" > "$output_file" || status=$?

if [ "$status" -eq 0 ] && [ -s "$output_file" ]; then
  cat "$output_file"
  cache_tmp="$cache_file.$$.tmp"
  if cat "$output_file" > "$cache_tmp"; then
    chmod 600 "$cache_tmp" 2>/dev/null || true
    if mv -f -- "$cache_tmp" "$cache_file"; then
      cache_tmp=''
    fi
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
