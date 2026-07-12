import { SettingsSchema, type Settings } from '@pi-ide/ipc-contracts';

export interface ResolvedSettings {
  global: Settings;
  effective: Settings;
  overrideKeys: string[];
  issues: string[];
}

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a raw settings value section by section: valid sections are kept,
 * invalid ones fall back to defaults and are reported as issues (SET-002).
 */
function parseLenient(raw: unknown, origin: string): { value: Settings; issues: string[] } {
  const issues: string[] = [];
  const defaults = SettingsSchema.parse({});
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) issues.push(`${origin}: settings root is not an object`);
    return { value: defaults, issues };
  }
  const direct = SettingsSchema.safeParse(raw);
  if (direct.success) return { value: direct.data, issues };

  // Per-key fallback: try key paths and drop the invalid leaves.
  const cleaned: PlainObject = {};
  for (const [section, sectionValue] of Object.entries(raw)) {
    if (!(section in defaults)) {
      issues.push(`${origin}: unknown section "${section}" ignored`);
      continue;
    }
    if (!isPlainObject(sectionValue)) {
      if (section !== 'schemaVersion')
        issues.push(`${origin}: section "${section}" invalid, using defaults`);
      continue;
    }
    const keep: PlainObject = {};
    for (const [key, value] of Object.entries(sectionValue)) {
      const candidate = { [section]: { [key]: value } };
      if (SettingsSchema.safeParse(candidate).success) {
        keep[key] = value;
      } else {
        issues.push(`${origin}: ${section}.${key} invalid, using default`);
      }
    }
    cleaned[section] = keep;
  }
  return { value: SettingsSchema.parse(cleaned), issues };
}

function deepMerge<T extends PlainObject>(
  base: T,
  patch: PlainObject,
  path: string[],
  keys: string[],
): T {
  const out: PlainObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const keyPath = [...path, key];
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as PlainObject, value, keyPath, keys);
    } else if (value !== undefined) {
      out[key] = value;
      keys.push(keyPath.join('.'));
    }
  }
  return out as T;
}

/** Resolve global settings + optional workspace override into effective settings. */
export function resolveSettings(
  globalRaw: unknown,
  workspaceOverrideRaw: unknown,
): ResolvedSettings {
  const globalParsed = parseLenient(globalRaw, 'global');
  const issues = [...globalParsed.issues];
  const overrideKeys: string[] = [];
  let effective = globalParsed.value;

  if (isPlainObject(workspaceOverrideRaw)) {
    // Validate the override merged over global, leniently.
    const overrideParsed = parseLenient(
      deepMerge(globalParsed.value as unknown as PlainObject, workspaceOverrideRaw, [], []),
      'workspace',
    );
    issues.push(...overrideParsed.issues);
    // Track which keys the override actually changes.
    effective = deepMerge(
      globalParsed.value as unknown as PlainObject,
      workspaceOverrideRaw,
      [],
      overrideKeys,
    ) as unknown as Settings;
    const validated = SettingsSchema.safeParse(effective);
    effective = validated.success ? validated.data : overrideParsed.value;
  } else if (workspaceOverrideRaw !== undefined && workspaceOverrideRaw !== null) {
    issues.push('workspace: override is not an object, ignored');
  }

  return { global: globalParsed.value, effective, overrideKeys, issues };
}
