import type { FieldDef } from "../db/schema.js";

/**
 * Plugin system — the extension surface that lets people add their own modules.
 *
 * Hybrid model:
 *  - **In-process extension points** (this file): custom field types, content
 *    lifecycle hooks, and extra MCP tools, loaded as modules.
 *  - **Event hooks for no-code**: the existing webhook/outbox system already
 *    lets external services react to changes — no plugin code required.
 *
 * A plugin is a plain object (see `definePlugin`). Plugins are trusted code in a
 * self-hosted deployment; sandboxing untrusted plugins is a future concern.
 */

type MaybePromise<T> = T | Promise<T>;

export interface HookContext {
  type: string;
  data: Record<string, unknown>;
  tenantId: string;
}

export interface EffectContext {
  entry: Record<string, unknown>;
  tenantId: string;
}

/** Transforms (and returns) the entry data. */
export type DataHook = (ctx: HookContext) => MaybePromise<Record<string, unknown>>;
/** Reacts to an event; return value ignored. */
export type EffectHook = (ctx: EffectContext) => MaybePromise<void>;

export interface PluginFieldType {
  /** The field `type` string, e.g. "email". */
  type: string;
  /** Return an error message, or null if the value is valid. */
  validate: (value: unknown, field: FieldDef) => string | null;
}

/** An MCP tool contributed by a plugin. `inputSchema` is a Zod raw shape. */
export interface McpToolContribution {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => MaybePromise<unknown>;
}

export interface Plugin {
  name: string;
  fieldTypes?: PluginFieldType[];
  hooks?: {
    beforeCreate?: DataHook;
    beforeUpdate?: DataHook;
    afterPublish?: EffectHook;
  };
  mcpTools?: McpToolContribution[];
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

// --- Registry --------------------------------------------------------------

const fieldTypes = new Map<string, PluginFieldType>();
const beforeCreate: DataHook[] = [];
const beforeUpdate: DataHook[] = [];
const afterPublish: EffectHook[] = [];
const mcpTools: McpToolContribution[] = [];
const loaded: string[] = [];

export function registerPlugin(plugin: Plugin): void {
  for (const ft of plugin.fieldTypes ?? []) fieldTypes.set(ft.type, ft);
  if (plugin.hooks?.beforeCreate) beforeCreate.push(plugin.hooks.beforeCreate);
  if (plugin.hooks?.beforeUpdate) beforeUpdate.push(plugin.hooks.beforeUpdate);
  if (plugin.hooks?.afterPublish) afterPublish.push(plugin.hooks.afterPublish);
  for (const t of plugin.mcpTools ?? []) mcpTools.push(t);
  loaded.push(plugin.name);
}

export function getFieldType(type: string): PluginFieldType | undefined {
  return fieldTypes.get(type);
}

export function getPluginMcpTools(): readonly McpToolContribution[] {
  return mcpTools;
}

export function loadedPlugins(): readonly string[] {
  return loaded;
}

/** Fold entry data through the registered data hooks for `name`. */
export async function runDataHook(
  name: "beforeCreate" | "beforeUpdate",
  ctx: HookContext,
): Promise<Record<string, unknown>> {
  const hooks = name === "beforeCreate" ? beforeCreate : beforeUpdate;
  let data = ctx.data;
  for (const hook of hooks) {
    data = await hook({ ...ctx, data });
  }
  return data;
}

/** Run effect hooks for `name`; a failing hook never breaks the mutation. */
export async function runEffectHook(name: "afterPublish", ctx: EffectContext): Promise<void> {
  const hooks = name === "afterPublish" ? afterPublish : [];
  await Promise.allSettled(hooks.map((h) => h(ctx)));
}

// --- Loader ----------------------------------------------------------------

/**
 * Load plugins listed in `plugins.json` ({ "plugins": ["specifier", ...] }) at
 * the working directory, plus any in the `CMS_PLUGINS` env (comma-separated).
 * Each specifier is a module that default-exports (or exports `plugin`) a Plugin.
 * Idempotent and best-effort: a broken plugin is logged and skipped.
 */
export async function loadPlugins(): Promise<void> {
  const specs = new Set<string>();
  for (const s of (process.env.CMS_PLUGINS ?? "").split(",")) {
    const t = s.trim();
    if (t) specs.add(t);
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("plugins.json", "utf8").catch(() => "");
    if (raw) {
      const parsed = JSON.parse(raw) as { plugins?: string[] };
      for (const s of parsed.plugins ?? []) specs.add(s);
    }
  } catch (e) {
    console.error("Failed to read plugins.json:", (e as Error).message);
  }

  await registerSpecs(specs);
}

async function registerSpecs(specs: Set<string>): Promise<void> {
  for (const spec of specs) {
    try {
      const mod = (await import(spec)) as { default?: Plugin; plugin?: Plugin };
      const plugin = mod.default ?? mod.plugin;
      if (plugin?.name) {
        registerPlugin(plugin);
        console.error(`Loaded plugin: ${plugin.name}`);
      } else {
        console.error(`Plugin "${spec}" has no default/plugin export`);
      }
    } catch (e) {
      console.error(`Failed to load plugin "${spec}":`, (e as Error).message);
    }
  }
}

/**
 * Add a module specifier (plugin or theme) to plugins.json so it loads at the
 * next startup. Idempotent. Used by `plugin:add` and the marketplace installer.
 */
export async function enablePlugin(spec: string): Promise<string[]> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const raw = await readFile("plugins.json", "utf8").catch(() => '{"plugins":[]}');
  const json = JSON.parse(raw) as { plugins?: string[] };
  json.plugins = Array.from(new Set([...(json.plugins ?? []), spec]));
  await writeFile("plugins.json", JSON.stringify(json, null, 2) + "\n", "utf8");
  return json.plugins;
}
