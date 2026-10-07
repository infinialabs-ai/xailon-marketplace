# Xailon Marketplace

A curated, self-hostable marketplace of [Xailon](https://github.com/infinialabs-ai) plugins,
skills, MCP servers, recipes and mods. Browse it at https://xailon-marketplace.infinialabs.ai. Every item is pinned to one commit, has an allow-listed
licence and a named reviewer, and declares exactly what it runs.

## Use it

```sh
xailon plugin marketplace add https://github.com/infinialabs-ai/xailon-marketplace.git
xailon plugin install github@infinia
```

In the desktop app: **Extensions → Plugins & hooks**, add the marketplace URL, then
install by name. Xailon releases that ship the built-in `infinia` marketplace add it for
you the first time you list marketplaces or install by name; set
`XAILON_DEFAULT_MARKETPLACE=off` to opt out.

## What is in this repository

```
hub.yaml                          marketplace name, title and the URL users add
catalog/{mcp,skills,recipes,mods,plugins}/<name>.yaml   one entry per item (source of truth)
plugins/<name>/                   items that live in this repository
.xailon-plugin/marketplace.json   GENERATED: the index Xailon reads
site/                             static catalog page; site/catalog.json and site/workflows.json are GENERATED
scripts/catalog.mjs               validate, inspect and generate
scripts/workflow.mjs              derive each recipe's team workflow from its definitions
scripts/ci.sh                     merge gate
scripts/deploy.sh                 publish site/ to Cloudflare Pages (reads .env, never committed)
```

Everything Xailon installs is a plugin, so each kind is a plugin shaped for its job:

| Kind | Plugin contents |
| --- | --- |
| `skill` | `skills/<name>/SKILL.md`, or an upstream folder with `SKILL.md` at its root. Installs without a prompt. |
| `mcp` | `plugin.json` and `.mcp.json` with one server, pinned to an exact package or image version. |
| `recipe` | `recipes/<name>.yaml`, an orchestrator recipe, with its role sub-recipes in `recipes/<name>/`. Nothing that runs code. Run with `xailon run --recipe <name>`. |
| `mod` | Output of the Xailon Mods SDK build: `plugin.json`, `hooks/hooks.json`, `xailon.mod.json`, `dist/`. |
| `plugin` | Anything else: commands, agents, hooks, several skills. |

> **MCP items:** Xailon records a plugin's MCP servers and shows them for approval,
> but current releases do not start them yet. The catalog page shows the equivalent
> `config.yaml` entry for each MCP item until that ships.

## Add or update an item

1. For an upstream item, pin it to a full commit SHA:

   ```yaml
   # catalog/skills/mcp-builder.yaml
   name: mcp-builder
   kind: skill
   title: MCP Builder
   summary: Guide for designing and building high-quality MCP servers.
   category: dev-tools
   tags: [mcp, servers]
   source:
     url: https://github.com/anthropics/skills.git
     path: skills/mcp-builder
     sha: 8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4
   license: Apache-2.0
   upstream: https://github.com/anthropics/skills/tree/main/skills/mcp-builder
   rank: 2          # order within its kind on the page; "Most used" lists featured items by rank
   featured: true
   reviewed: { by: your-handle, at: 2026-10-05 }
   ```

   For an item that lives here, add `plugins/<name>/` and use `source: ./plugins/<name>`.
   MCP items list the variables their server reads under `env:` with a description each.

2. Run `npm install` once, then `npm run build` and commit the regenerated files.
3. Open a pull request. The reviewer reads everything listed under *What it runs* on
   the item's page before approving, and updates `reviewed` when bumping a pin.

`npm run check` (and `scripts/ci.sh`) fails when:

- a name is not a valid Xailon plugin name, or the file name does not match it;
- an upstream source is not `https://` or not pinned to a 40-character SHA;
- the licence is not on the allow-list in `scripts/catalog.mjs`;
- the item's contents do not match its kind (a `skill` with hooks, an `mcp` with no server);
- `env` does not describe exactly the variables its MCP servers read;
- two items share a name, or two items of one kind share a rank;
- the generated files are out of date.

`scripts/ci.sh` also installs every item with the real `xailon` binary into a
throwaway `XAILON_PATH_ROOT` when `xailon` is on `PATH`.

## Business systems

`catalog/business-systems.yaml` maps ERP, accounting, HR and commerce systems to the MCP
servers that exist for them: whether the vendor ships one (`ga`, `preview`, `sample`,
`announced` or `none`), the open-source servers and how to run them yourself, what is still
missing, and which marketplace packages cover the system. Every entry cites the vendor's or
the project's own documentation and the date it was checked. The site renders it under
*Business systems*; `npm run check` rejects unknown statuses, non-https references and
packages that are not MCP items in the catalog.

Tenant-specific endpoints are written with variables, for example
`"url": "${ODOO_URL}/mcp"` with `"Authorization": "Bearer ${ODOO_API_KEY}"`; the item's `env`
describes each variable. Some official servers (Dynamics 365 Business Central and Finance &
Operations, Shopify, Square, BambooHR) only accept pre-registered OAuth clients, so the map
lists them but no package can connect to them directly yet.

## Recipes

The 100 multi-agent recipes are derived from
[revfactory/harness-100](https://github.com/revfactory/harness-100) (Apache-2.0); each recipe
plugin carries the licence and a `NOTICE` describing the changes. Where the upstream English
text was damaged by machine translation, the recipe was translated again from the Korean
original.

Recipes installed as plugins appear in `xailon recipe list` and the Recipes view in Xailon
releases that load recipes from plugins. With an older release, point
`XAILON_RECIPE_PATH` at a recipe plugin's `recipes/` folder in a clone of this repository.

## The catalog page

`site/` is a static page with no build step and no third-party requests (fonts are
vendored). `npm run serve` builds the data and serves it on http://localhost:8080.
To publish, copy `site/` to any static host after `npm run build`, or run
`scripts/deploy.sh` to publish to Cloudflare Pages. It reads `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from `.env` and creates the project, custom domain and DNS record
on first run.

Each recipe's page draws how its team works: who leads, which stage hands what to whom,
where a review sends work back, and the workflow patterns that adds up to. None of it is
written by hand. `scripts/workflow.mjs` reads the recipe's orchestrator and sub-recipe
files on every build, taking the handoffs from each role's "Team Communication Protocol"
list and the stage order from the `_workspace/NN_*` files the roles write. Names in those
lists that match no role in the recipe are shown on the page rather than guessed.

## Self-hosting

Mirror this repository to your own Gitea, Forgejo or GitLab, set `git_url` and
`repo_url` in `hub.yaml` to the mirror, run `npm run build`, and commit. Xailon accepts
`https://`, `ssh://` and `user@host:path` marketplace URLs. Upstream items are fetched
from their own repositories at install time; to keep installs inside your network,
mirror those repositories too and point each entry's `source.url` at the mirror.
