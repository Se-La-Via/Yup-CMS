/**
 * Install a plugin and register it in plugins.json — the groundwork for a
 * future marketplace ("npm for Yup plugins").
 *
 *   npm run plugin:add <npm-package | ./path/to/plugin.js>
 *
 * npm packages are installed; relative paths are added as-is. The configured
 * plugins are loaded at server startup.
 */
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function main() {
  const spec = process.argv[2];
  if (!spec) {
    console.error("usage: npm run plugin:add <npm-package | ./path/to/plugin.js>");
    process.exit(1);
  }

  const isLocal = spec.startsWith(".") || spec.startsWith("/");
  if (!isLocal) {
    const r = spawnSync("npm", ["install", spec], { stdio: "inherit", shell: true });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  const raw = await readFile("plugins.json", "utf8").catch(() => '{"plugins":[]}');
  const json = JSON.parse(raw) as { plugins?: string[] };
  json.plugins = Array.from(new Set([...(json.plugins ?? []), spec]));
  await writeFile("plugins.json", JSON.stringify(json, null, 2) + "\n", "utf8");

  console.log(`✓ Added "${spec}" to plugins.json (${json.plugins.length} plugin(s)).`);
  console.log("  Restart the server to load it.");
}

main();
