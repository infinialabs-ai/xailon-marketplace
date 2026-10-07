#!/usr/bin/env node
// Validates catalog/**/*.yaml, inspects what every item runs, and generates the
// marketplace index Xailon reads plus the data file the catalog page renders.
//
//   node scripts/catalog.mjs build   write the generated files
//   node scripts/catalog.mjs check   fail if the catalog is invalid or the files are stale

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { recipeWorkflow } from "./workflow.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache", "repos");
const INDEX_FILE = ".xailon-plugin/marketplace.json";
const SITE_DATA_FILE = "site/catalog.json";
// Loaded only when a recipe is opened, so the catalog itself stays small.
const SITE_WORKFLOWS_FILE = "site/workflows.json";

const KINDS = { mcp: "mcp", skill: "skills", recipe: "recipes", mod: "mods", plugin: "plugins" };
const LICENSES = new Set([
  "Apache-2.0",
  "MIT",
  "Apache-2.0 OR MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
]);
const PLUGIN_MANIFESTS = [
  ".xailon-plugin/plugin.json",
  ".plugin/plugin.json",
  ".claude-plugin/plugin.json",
  "plugin.json",
  "gemini-extension.json",
];
// A vendor-hosted MCP endpoint has no source to license; only remote-only items may use it.
const HOSTED = "Hosted";
const SHA = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Same rule as Xailon's plugin and marketplace names, so every catalog name installs.
function validName(name) {
  return (
    typeof name === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) &&
    !name.includes("..")
  );
}

function safeRelative(p) {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    !path.isAbsolute(p) &&
    !p.split("/").some((part) => part === ".." || part === "")
  );
}

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, "utf8"));
}

function loadHub(errors) {
  const hub = readYaml(path.join(ROOT, "hub.yaml"));
  if (!validName(hub?.name)) errors.push("hub.yaml: name must be a valid marketplace name");
  if (!hub?.git_url) errors.push("hub.yaml: git_url is required");
  return hub ?? {};
}

function loadEntries(errors) {
  const entries = [];
  for (const [kind, dir] of Object.entries(KINDS)) {
    const folder = path.join(ROOT, "catalog", dir);
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder).sort()) {
      if (!file.endsWith(".yaml")) continue;
      const where = `catalog/${dir}/${file}`;
      let entry;
      try {
        entry = readYaml(path.join(folder, file));
      } catch (error) {
        errors.push(`${where}: ${error.message}`);
        continue;
      }
      entries.push({ where, folderKind: kind, file, entry });
    }
  }
  return entries;
}

function validateEntry({ where, folderKind, file, entry }, errors) {
  const fail = (message) => errors.push(`${where}: ${message}`);
  if (!entry || typeof entry !== "object") return fail("not a mapping");

  if (!validName(entry.name)) fail("name must be 1-64 of a-z 0-9 . _ - starting with a letter or digit");
  if (file !== `${entry.name}.yaml`) fail(`file must be named ${entry.name}.yaml`);
  if (entry.kind !== folderKind) fail(`kind must be '${folderKind}' for this folder`);
  for (const field of ["title", "summary", "category"]) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) fail(`${field} is required`);
  }
  if (entry.summary?.length > 160) fail("summary must be 160 characters or fewer");
  if (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== "string")) {
    fail("tags must be a list of strings");
  }
  if (!LICENSES.has(entry.license) && entry.license !== HOSTED) {
    fail(`license '${entry.license}' is not on the allow-list (${[...LICENSES].join(", ")}, or ${HOSTED} for remote MCP endpoints)`);
  }
  if (!Number.isInteger(entry.rank) || entry.rank < 1) fail("rank must be a positive integer");
  if (typeof entry.featured !== "boolean") fail("featured must be true or false");
  if (entry.notes !== undefined && (typeof entry.notes !== "string" || entry.notes.length > 400)) {
    fail("notes must be text of 400 characters or fewer");
  }
  if (entry.official !== undefined && typeof entry.official !== "boolean") fail("official must be true or false");
  if (typeof entry.reviewed?.by !== "string" || !DATE.test(String(entry.reviewed?.at))) {
    fail("reviewed needs by: <reviewer> and at: YYYY-MM-DD");
  }
  if (entry.env !== undefined && (typeof entry.env !== "object" || Array.isArray(entry.env))) {
    fail("env must map variable names to descriptions");
  }

  const source = entry.source;
  if (typeof source === "string") {
    const local = source.replace(/^\.\//, "");
    if (!source.startsWith("./plugins/") || !safeRelative(local)) {
      fail("a local source must be ./plugins/<folder>");
    } else if (!fs.existsSync(path.join(ROOT, local))) {
      fail(`${source} does not exist`);
    }
  } else if (source && typeof source === "object") {
    if (!/^https:\/\//.test(source.url ?? "")) fail("source.url must be an https git URL");
    if (!SHA.test(source.sha ?? "")) fail("source.sha must pin a full 40-character commit");
    if (source.path !== undefined && !safeRelative(source.path)) fail("source.path must stay inside the repository");
    const extra = Object.keys(source).filter((key) => !["url", "path", "sha"].includes(key));
    if (extra.length) fail(`unknown source fields: ${extra.join(", ")}`);
  } else {
    fail("source is required");
  }
}

// A tree is a list of { path, executable } relative to the plugin root, plus a reader.
function localTree(dir) {
  const files = [];
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      if (item.name === ".DS_Store" || item.name === "__pycache__") continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else {
        const mode = fs.statSync(full).mode;
        files.push({ path: path.relative(dir, full).split(path.sep).join("/"), executable: (mode & 0o111) !== 0 });
      }
    }
  };
  walk(dir);
  return {
    files,
    read: (file) => {
      const full = path.join(dir, file);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
    },
  };
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

// Fetches only the pinned commit into a bare cache, and reads files from git objects,
// never a checkout, mirroring how Xailon installs.
function gitTree({ url, path: subdir, sha }) {
  const repo = path.join(CACHE, createHash("sha256").update(url).digest("hex").slice(0, 16));
  if (!fs.existsSync(repo)) {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, "init", "--bare", "--quiet");
  }
  try {
    git(repo, "cat-file", "-e", `${sha}^{commit}`);
  } catch {
    git(repo, "fetch", "--quiet", "--depth", "1", url, sha);
  }
  const prefix = subdir ? `${subdir}/` : "";
  const files = git(repo, "ls-tree", "-r", "--full-tree", sha, "--", subdir ?? ".")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t");
      const [mode, type] = meta.split(" ");
      return { path: file.slice(prefix.length), executable: mode === "100755", submodule: type === "commit" };
    });
  return {
    files,
    read: (file) => {
      try {
        return git(repo, "show", `${sha}:${prefix}${file}`);
      } catch {
        return null;
      }
    },
  };
}

function readJson(tree, file, fail) {
  const text = tree.read(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
    return null;
  }
}

function mcpServersOf(tree, fail) {
  const found = [];
  const collect = (value) => {
    const servers = value?.mcpServers ?? value;
    if (!servers || typeof servers !== "object") return;
    for (const [name, server] of Object.entries(servers)) {
      found.push({
        name,
        command: server.command ?? null,
        args: server.args ?? [],
        url: server.url ?? null,
        type: server.type ?? (server.url ? "http" : "stdio"),
        headers: server.headers ?? {},
        // Variables the user must supply, referenced as ${VAR}; anything else is a fixed value.
        env: [
          ...new Set(
            [...Object.values(server.env ?? {}), ...Object.values(server.headers ?? {})].flatMap((value) =>
              [...String(value).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]),
            ),
          ),
        ],
        fixedEnv: Object.fromEntries(Object.entries(server.env ?? {}).filter(([, value]) => !String(value).includes("${"))),
      });
    }
  };
  collect(readJson(tree, ".mcp.json", fail));
  for (const manifest of PLUGIN_MANIFESTS) {
    const value = readJson(tree, manifest, fail)?.mcpServers;
    if (typeof value === "string") collect(readJson(tree, value.replace(/^\.\//, ""), fail));
    else if (value) collect(value);
  }
  return found;
}

function hooksOf(tree, fail) {
  const config = readJson(tree, "hooks/hooks.json", fail)?.hooks ?? {};
  const hooks = [];
  for (const [event, rules] of Object.entries(config)) {
    for (const rule of rules ?? []) {
      for (const action of rule.hooks ?? []) {
        hooks.push({
          event,
          matcher: rule.matcher ?? null,
          run: action.command ?? action.url ?? action.type,
        });
      }
    }
  }
  return hooks;
}

function inspect(entry, fail) {
  let tree;
  try {
    tree =
      typeof entry.source === "string"
        ? localTree(path.join(ROOT, entry.source.replace(/^\.\//, "")))
        : gitTree(entry.source);
  } catch (error) {
    fail(`could not read source: ${error.message.split("\n")[0]}`);
    return null;
  }
  if (tree.files.length === 0) {
    fail("source has no files");
    return null;
  }

  const paths = new Set(tree.files.map((file) => file.path));
  const skills = tree.files
    .map((file) => file.path.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1])
    .filter(Boolean);
  if (skills.length === 0 && paths.has("SKILL.md")) {
    skills.push(YAML.parse(tree.read("SKILL.md").split(/^---$/m)[1] ?? "")?.name ?? entry.name);
  }
  const recipes = tree.files.map((f) => f.path.match(/^recipes\/([^/]+)\.(?:yaml|yml|json)$/)?.[1]).filter(Boolean);
  const manifest = PLUGIN_MANIFESTS.find((file) => paths.has(file));
  const contents = {
    manifest: manifest ?? null,
    skills,
    recipes: recipes.map((recipe) => ({
      name: recipe,
      roles: tree.files
        .map((f) => f.path.match(new RegExp(`^recipes/${recipe}/([^/]+)\\.(?:yaml|yml|json)$`))?.[1])
        .filter(Boolean),
    })),
    commands: tree.files.map((f) => f.path.match(/^commands\/(.+)\.md$/)?.[1]).filter(Boolean),
    agents: tree.files.map((f) => f.path.match(/^agents\/(.+)\.md$/)?.[1]).filter(Boolean),
    mcpServers: mcpServersOf(tree, fail),
    hooks: hooksOf(tree, fail),
    executables: tree.files.filter((f) => f.executable || f.path.startsWith("bin/")).map((f) => f.path),
    submodules: tree.files.filter((f) => f.submodule).map((f) => f.path),
    panels: readJson(tree, "xailon.mod.json", fail)?.panels?.map(({ id, title }) => ({ id, title })) ?? [],
  };

  if (manifest) {
    const declared = readJson(tree, manifest, fail)?.name;
    if (declared && declared !== entry.name) fail(`${manifest} names the plugin '${declared}', not '${entry.name}'`);
  } else if (skills.length === 0 && recipes.length === 0) {
    fail(`source has no plugin manifest (${PLUGIN_MANIFESTS.join(", ")}) and no skills`);
  }

  const kindRules = {
    mcp: () => contents.mcpServers.length > 0 || "an mcp item must declare at least one MCP server",
    skill: () =>
      (contents.skills.length > 0 && contents.hooks.length === 0 && contents.mcpServers.length === 0) ||
      "a skill item must contain skills and no hooks or MCP servers",
    recipe: () =>
      (recipes.length > 0 &&
        contents.hooks.length + contents.mcpServers.length + contents.executables.length === 0) ||
      "a recipe item must contain recipes/<name>.yaml and nothing that runs code",
    mod: () => paths.has("xailon.mod.json") || "a mod item must contain xailon.mod.json",
    plugin: () => true,
  };
  const verdict = kindRules[entry.kind]();
  if (verdict !== true) fail(verdict);

  const workflows = {};
  for (const recipe of recipes) {
    try {
      workflows[recipe] = recipeWorkflow(tree.read, recipe);
    } catch (error) {
      fail(`could not read recipe ${recipe}: ${error.message.split("\n")[0]}`);
    }
  }

  const remoteOnly = contents.mcpServers.length > 0 && contents.mcpServers.every((server) => server.url);
  if (entry.license === HOSTED && (entry.kind !== "mcp" || !remoteOnly)) {
    fail(`license ${HOSTED} is only for mcp items whose servers are all remote endpoints`);
  }
  for (const server of contents.mcpServers) {
    if (server.url && !/^https:\/\//.test(server.url)) fail(`MCP server ${server.name} must use an https URL`);
  }

  const declaredEnv = Object.keys(entry.env ?? {}).sort();
  const usedEnv = [...new Set(contents.mcpServers.flatMap((server) => server.env))].sort();
  if (declaredEnv.join() !== usedEnv.join()) {
    fail(`env must describe exactly the variables its MCP servers read: ${usedEnv.join(", ") || "none"}`);
  }
  return { contents, workflows };
}

// Shown on the page for MCP items while Xailon does not start plugin MCP servers.
function configSnippet(contents) {
  const extensions = {};
  for (const server of contents.mcpServers) {
    extensions[server.name] =
      server.type === "stdio"
        ? {
            type: "stdio",
            name: server.name,
            cmd: server.command,
            args: server.args,
            ...(Object.keys(server.fixedEnv).length ? { envs: server.fixedEnv } : {}),
            ...(server.env.length ? { env_keys: server.env } : {}),
            enabled: true,
            timeout: 300,
          }
        : {
            type: "streamable_http",
            name: server.name,
            uri: server.url,
            ...(Object.keys(server.headers).length ? { headers: server.headers } : {}),
            ...(server.env.length ? { env_keys: server.env } : {}),
            enabled: true,
            timeout: 300,
          };
  }
  const doc = new YAML.Document({ extensions });
  YAML.visit(doc, {
    Seq(_, node) {
      node.flow = true;
    },
  });
  return doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).trimEnd();
}

function indexSource(source) {
  return typeof source === "string" ? source : { url: source.url, ...(source.path ? { path: source.path } : {}), sha: source.sha };
}

function byKindThenRank(a, b) {
  const order = Object.keys(KINDS);
  return order.indexOf(a.kind) - order.indexOf(b.kind) || a.rank - b.rank || a.name.localeCompare(b.name);
}

function generate() {
  const errors = [];
  const hub = loadHub(errors);
  const loaded = loadEntries(errors);
  const seen = new Map();
  const items = [];
  const workflows = {};

  for (const record of loaded) {
    const before = errors.length;
    validateEntry(record, errors);
    const { entry, where } = record;
    if (seen.has(entry.name)) errors.push(`${where}: name '${entry.name}' is also used by ${seen.get(entry.name)}`);
    seen.set(entry.name, where);
    if (errors.length !== before) continue;

    const inspected = inspect(entry, (message) => errors.push(`${where}: ${message}`));
    if (!inspected) continue;
    const { contents } = inspected;
    if (Object.keys(inspected.workflows).length) workflows[entry.name] = inspected.workflows;
    items.push({
      ...entry,
      install: `${entry.name}@${hub.name}`,
      contents,
      runsCode: contents.hooks.length + contents.mcpServers.length + contents.executables.length > 0,
      ...(entry.kind === "mcp" ? { configSnippet: configSnippet(contents) } : {}),
    });
  }

  for (const kind of Object.keys(KINDS)) {
    const ranks = items.filter((item) => item.kind === kind).map((item) => item.rank);
    const duplicates = ranks.filter((rank, i) => ranks.indexOf(rank) !== i);
    if (duplicates.length) errors.push(`catalog/${KINDS[kind]}: rank ${[...new Set(duplicates)].join(", ")} used more than once`);
  }

  items.sort(byKindThenRank);
  const index = {
    name: hub.name,
    description: hub.description,
    plugins: items.map((item) => ({
      name: item.name,
      description: item.summary,
      source: indexSource(item.source),
      category: item.category,
      tags: item.tags,
    })),
  };
  const site = {
    marketplace: { name: hub.name, title: hub.title, description: hub.description, gitUrl: hub.git_url, repoUrl: hub.repo_url },
    items,
  };
  return {
    errors,
    files: {
      [INDEX_FILE]: `${JSON.stringify(index, null, 2)}\n`,
      [SITE_DATA_FILE]: `${JSON.stringify(site, null, 2)}\n`,
      [SITE_WORKFLOWS_FILE]: `${JSON.stringify(Object.fromEntries(items.filter((item) => workflows[item.name]).map((item) => [item.name, workflows[item.name]])))}\n`,
    },
    count: items.length,
  };
}

function main() {
  const mode = process.argv[2];
  if (!["build", "check"].includes(mode)) {
    console.error("usage: catalog.mjs build|check");
    process.exit(2);
  }
  const { errors, files, count } = generate();
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  if (mode === "build") {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, file), text);
    }
    console.log(`Wrote ${Object.keys(files).join(" and ")} with ${count} items`);
    return;
  }
  const stale = Object.entries(files).filter(([file, text]) => {
    const full = path.join(ROOT, file);
    return !fs.existsSync(full) || fs.readFileSync(full, "utf8") !== text;
  });
  if (stale.length) {
    for (const [file] of stale) console.error(`error: ${file} is out of date; run npm run build`);
    process.exit(1);
  }
  console.log(`Catalog OK: ${count} items`);
}

main();
