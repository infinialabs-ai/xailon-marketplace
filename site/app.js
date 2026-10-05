const KIND_LABELS = { mcp: "MCP server", skill: "Skill", recipe: "Recipe", mod: "Mod", plugin: "Plugin" };
const KIND_TABS = { mcp: "MCP", skill: "Skills", recipe: "Recipes", mod: "Mods", plugin: "Plugins" };
const KIND_ORDER = Object.keys(KIND_LABELS);

const state = { items: [], marketplace: {}, kind: "all", query: "", noCode: false };

const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad = (n) => String(n).padStart(2, "0");

function addCommand() {
  return `xailon plugin marketplace add ${state.marketplace.gitUrl}`;
}

function installCommand(item) {
  return `xailon plugin install ${item.install}`;
}

function runsSummary(item) {
  const { mcpServers, hooks, executables } = item.contents;
  const parts = [];
  if (mcpServers.length) {
    const how = [...new Set(mcpServers.map((s) => (s.url ? "remote" : s.command)))].join(", ");
    parts.push(`MCP · ${how}`);
  }
  if (hooks.length) parts.push(`${hooks.length} hook${hooks.length > 1 ? "s" : ""}`);
  if (executables.length) parts.push(`${executables.length} script${executables.length > 1 ? "s" : ""}`);
  return parts.join(" + ");
}

function runsStamp(item) {
  return item.runsCode
    ? `<span class="stamp stamp--runs" title="Xailon asks before installing this">Runs ${escapeHtml(runsSummary(item))}</span>`
    : `<span class="stamp stamp--safe" title="Installs without a prompt">No code</span>`;
}

function sourceInfo(item) {
  const repoUrl = state.marketplace.repoUrl;
  if (typeof item.source === "string") {
    const path = item.source.replace(/^\.\//, "");
    return {
      short: "in this repo",
      detail: path,
      href: repoUrl ? `${repoUrl}/tree/main/${path}` : null,
      pin: "The marketplace commit you added or last updated",
    };
  }
  const base = item.source.url.replace(/\.git$/, "");
  const repo = base.replace(/^https:\/\/[^/]+\//, "");
  return {
    short: item.source.sha.slice(0, 7),
    detail: repo,
    href: `${base}/tree/${item.source.sha}${item.source.path ? `/${item.source.path}` : ""}`,
    pin: item.source.sha,
  };
}

function searchText(item) {
  return [item.name, item.title, item.summary, item.category, item.kind, ...(item.tags ?? [])].join(" ").toLowerCase();
}

function visibleItems() {
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  return state.items.filter(
    (item) =>
      (state.kind === "all" || item.kind === state.kind) &&
      (!state.noCode || !item.runsCode) &&
      words.every((word) => searchText(item).includes(word)),
  );
}

function renderMasthead() {
  const { marketplace, items } = state;
  document.title = marketplace.title ?? "Xailon Marketplace";
  const words = (marketplace.title ?? "Xailon Marketplace").split(" ");
  const last = words.pop();
  $("#title").innerHTML = `${escapeHtml(words.join(" "))} <em>${escapeHtml(last)}</em>`;
  $("#description").textContent = marketplace.description ?? "";
  $("#manifest-no").textContent = `Manifest · @${marketplace.name}`;
  $("#add-command").textContent = addCommand();
  const repo = $("#repo-link");
  if (marketplace.repoUrl) repo.href = marketplace.repoUrl;
  else repo.remove();

  const count = (kind) => items.filter((item) => item.kind === kind).length;
  const tally = [
    ["Items", items.length],
    ["MCP servers", count("mcp")],
    ["Skills", count("skill")],
    ["Recipes", count("recipe")],
    ["Mods & plugins", count("mod") + count("plugin")],
    ["No-code installs", items.filter((item) => !item.runsCode).length],
  ];
  $("#tally").innerHTML = tally
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");

  const reviewed = items.map((item) => item.reviewed.at).sort().at(-1);
  $("#footer-meta").innerHTML = `@${escapeHtml(marketplace.name)} · last review ${escapeHtml(reviewed ?? "—")} · <a href="catalog.json">catalog.json</a>`;
}

function renderTickets() {
  const featured = state.items
    .filter((item) => item.featured)
    .sort((a, b) => a.rank - b.rank || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  $("#tickets").innerHTML = featured
    .map(
      (item, i) => `
      <button class="ticket" type="button" data-open="${escapeHtml(item.name)}">
        <span class="ticket__stub">
          <span class="ticket__rank">${pad(i + 1)}</span>
          <span class="ticket__kind">${escapeHtml(KIND_LABELS[item.kind])}</span>
        </span>
        <span class="ticket__body">
          <span class="ticket__title">${escapeHtml(item.title)}</span>
          <span class="ticket__summary">${escapeHtml(item.summary)}</span>
          <span class="ticket__foot">${runsStamp(item)}</span>
          <span class="ticket__install">${escapeHtml(installCommand(item))}</span>
        </span>
      </button>`,
    )
    .join("");
  $("#tickets").querySelectorAll(".ticket").forEach((ticket, i) => ticket.style.setProperty("--i", i));
}

function renderKinds() {
  const present = KIND_ORDER.filter((kind) => state.items.some((item) => item.kind === kind));
  const tabs = [["all", "All", state.items.length], ...present.map((kind) => [kind, KIND_TABS[kind], state.items.filter((i) => i.kind === kind).length])];
  $("#kinds").innerHTML = tabs
    .map(
      ([kind, label, n]) =>
        `<button class="kind-tab" type="button" role="tab" data-kind="${kind}" aria-selected="${state.kind === kind}">${label}<span>${n}</span></button>`,
    )
    .join("");
}

function renderRows() {
  const items = visibleItems();
  if (items.length === 0) {
    $("#rows").innerHTML = `<p class="empty">Nothing in the catalog matches that.</p>`;
    return;
  }
  let group = null;
  $("#rows").innerHTML = items
    .map((item) => {
      const source = sourceInfo(item);
      const heading =
        state.kind === "all" && item.kind !== group
          ? `<h3 class="group">${escapeHtml(KIND_TABS[item.kind])}<span>${state.items.filter((i) => i.kind === item.kind).length}</span></h3>`
          : "";
      group = item.kind;
      return `${heading}
      <button class="row" type="button" data-open="${escapeHtml(item.name)}">
        <span class="row__no">${pad(item.rank)}</span>
        <span class="row__main">
          <span class="row__title">${escapeHtml(item.title)}</span>
          <span class="row__summary">${escapeHtml(item.summary)}</span>
          <span class="row__tags">${[...new Set([item.category, ...(item.tags ?? [])])].map(escapeHtml).join(" · ")}</span>
        </span>
        <span class="row__kind"><span class="stamp stamp--plain">${escapeHtml(KIND_TABS[item.kind])}</span></span>
        <span class="row__runs">${runsStamp(item)}</span>
        <span class="row__pin">${escapeHtml(source.short)}<small>${escapeHtml(source.detail)}</small></span>
      </button>`;
    })
    .join("");
}

function commandBox(command) {
  return `<div class="cmd"><code>${escapeHtml(command)}</code><button class="copy" type="button" data-copy="${escapeHtml(command)}" aria-label="Copy command">Copy</button></div>`;
}

function runsList(item) {
  const { mcpServers, hooks, executables } = item.contents;
  const rows = [
    ...mcpServers.map(
      (s) => `<li><b>MCP</b><span><strong>${escapeHtml(s.name)}</strong>: <code>${escapeHtml(s.url ?? [s.command, ...s.args].join(" "))}</code></span></li>`,
    ),
    ...hooks.map(
      (h) => `<li><b>Hook</b><span>${escapeHtml(h.event)}${h.matcher ? ` (${escapeHtml(h.matcher)})` : ""}: <code>${escapeHtml(h.run)}</code></span></li>`,
    ),
    ...executables.map((file) => `<li><b>Script</b><code>${escapeHtml(file)}</code></li>`),
  ];
  if (rows.length === 0) {
    return `<ul class="runs"><li class="safe"><b>Nothing</b><span>Instructions only. Xailon installs it without asking, and plugin skills never run shell commands.</span></li></ul>`;
  }
  return `<p>Xailon shows this list and asks for approval before installing or updating.</p><ul class="runs">${rows.join("")}</ul>`;
}

function contentsFacts(item) {
  const c = item.contents;
  const facts = [
    ["Skills", c.skills],
    ["Recipes", c.recipes.map((r) => r.name)],
    ["Commands", c.commands],
    ["Agents", c.agents],
    ["Panels", c.panels.map((p) => `${item.name}/${p.id}`)],
  ].filter(([, list]) => list.length);
  return facts.map(([label, list]) => `<dt>${label}</dt><dd>${list.map((x) => `<code>${escapeHtml(x)}</code>`).join(", ")}</dd>`).join("");
}

function mcpNotice(item) {
  if (item.kind !== "mcp") return "";
  return `
    <section class="block">
      <h3>Until plugin MCP servers load</h3>
      <div class="notice">
        <p>Current Xailon releases install this plugin and show its server for approval, but do not start MCP servers from plugins yet. Until they do, add the server to <code>config.yaml</code> directly:</p>
        <div class="snippet-wrap"><pre class="snippet">${escapeHtml(item.configSnippet)}</pre><button class="copy" type="button" data-copy="${escapeHtml(item.configSnippet)}">Copy</button></div>
      </div>
    </section>`;
}

function recipeBlock(item) {
  if (item.kind !== "recipe") return "";
  const [recipe] = item.contents.recipes;
  const folder = `plugins/${item.name}/recipes`;
  return `
    <section class="block">
      <h3>Run it</h3>
      ${commandBox(`xailon run --recipe ${recipe.name}`)}
      <p class="roles-label">An orchestrator that hands work to ${recipe.roles.length} specialist role${recipe.roles.length === 1 ? "" : "s"}:</p>
      <ul class="roles">${recipe.roles.map((role) => `<li>${escapeHtml(role.replace(/-/g, " "))}</li>`).join("")}</ul>
      <div class="notice">
        <p>Installed recipes appear in <code>xailon recipe list</code> and the Recipes view once your Xailon release loads recipes from plugins. With an older release, point Xailon at a clone instead:</p>
        <div class="snippet-wrap"><pre class="snippet">${escapeHtml(`git clone ${state.marketplace.gitUrl}
export XAILON_RECIPE_PATH="$PWD/xailon-marketplace/${folder}"`)}</pre><button class="copy" type="button" data-copy="${escapeHtml(`git clone ${state.marketplace.gitUrl}
export XAILON_RECIPE_PATH="$PWD/xailon-marketplace/${folder}"`)}">Copy</button></div>
      </div>
    </section>`;
}

function envBlock(item) {
  const env = Object.entries(item.env ?? {});
  if (!env.length) return "";
  return `
    <section class="block">
      <h3>Needs</h3>
      <ul class="env">${env.map(([key, text]) => `<li><code>${escapeHtml(key)}</code>${escapeHtml(text)}</li>`).join("")}</ul>
    </section>`;
}

function openItem(name) {
  const item = state.items.find((candidate) => candidate.name === name);
  if (!item) return;
  const source = sourceInfo(item);
  const drawer = $("#drawer");
  $("#drawer-body").innerHTML = `
    <div class="drawer__top">
      <span class="eyebrow eyebrow--flush">${escapeHtml(KIND_LABELS[item.kind])} · No. ${pad(item.rank)}</span>
      <button class="close" type="button" data-close>Close</button>
    </div>
    <h2 id="drawer-title">${escapeHtml(item.title)}</h2>
    <p class="drawer__summary">${escapeHtml(item.summary)}</p>
    <div class="drawer__stamps">
      ${item.official ? `<span class="stamp stamp--safe">Official</span>` : ""}
      ${runsStamp(item)}
      <span class="stamp stamp--plain">${escapeHtml(item.license === "Hosted" ? "Hosted service" : item.license)}</span>
      <span class="stamp stamp--plain">${escapeHtml(item.category)}</span>
    </div>

    <section class="block">
      <h3>Install</h3>
      <ol class="steps">
        <li><div><span class="label">Once per machine, add the marketplace</span>${commandBox(addCommand())}</div></li>
        <li><div><span class="label">Install, pinned to one commit</span>${commandBox(installCommand(item))}</div></li>
      </ol>
    </section>
    ${mcpNotice(item)}
    ${recipeBlock(item)}
    ${envBlock(item)}

    <section class="block">
      <h3>What it runs</h3>
      ${runsList(item)}
    </section>

    <section class="block">
      <h3>Provenance</h3>
      <dl class="facts">
        <dt>Source</dt><dd>${source.href ? `<a href="${escapeHtml(source.href)}" rel="noopener">${escapeHtml(source.detail)}</a>` : escapeHtml(source.detail)}</dd>
        <dt>Pinned to</dt><dd><code>${escapeHtml(source.pin)}</code></dd>
        ${item.upstream ? `<dt>Upstream</dt><dd><a href="${escapeHtml(item.upstream)}" rel="noopener">${escapeHtml(item.upstream.replace(/^https:\/\//, ""))}</a></dd>` : ""}
        <dt>Reviewed</dt><dd>${escapeHtml(item.reviewed.by)} on ${escapeHtml(item.reviewed.at)}</dd>
        <dt>Licence</dt><dd>${item.license === "Hosted" ? "Hosted by the vendor; the service's own terms apply" : escapeHtml(item.license)}</dd>
        ${item.notes ? `<dt>Notes</dt><dd>${escapeHtml(item.notes)}</dd>` : ""}
        ${contentsFacts(item)}
      </dl>
    </section>`;
  if (!drawer.open) drawer.showModal();
  drawer.scrollTop = 0;
  $("#drawer-body .close").focus();
  if (location.hash !== `#/item/${item.name}`) history.replaceState(null, "", `#/item/${item.name}`);
}

function closeDrawer() {
  const drawer = $("#drawer");
  if (drawer.open) drawer.close();
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Self-hosted over plain http has no clipboard API.
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  button.textContent = "Copied";
  button.dataset.done = "";
  setTimeout(() => {
    button.textContent = "Copy";
    delete button.dataset.done;
  }, 1400);
}

function routeFromHash() {
  const match = location.hash.match(/^#\/item\/([a-z0-9._-]+)$/);
  if (match) openItem(match[1]);
  else closeDrawer();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-open], [data-copy], [data-kind], [data-close], .hookup .copy");
    if (!target) return;
    if (target.matches("[data-copy]")) copy(target.dataset.copy, target);
    else if (target.matches(".hookup .copy")) copy(addCommand(), target);
    else if (target.matches("[data-open]")) openItem(target.dataset.open);
    else if (target.matches("[data-close]")) closeDrawer();
    else if (target.matches("[data-kind]")) {
      state.kind = target.dataset.kind;
      renderKinds();
      renderRows();
    }
  });

  const drawer = $("#drawer");
  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) closeDrawer();
  });
  drawer.addEventListener("close", () => {
    if (location.hash.startsWith("#/item/")) history.replaceState(null, "", location.pathname + location.search);
  });

  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderRows();
  });
  $("#no-code").addEventListener("change", (event) => {
    state.noCode = event.target.checked;
    renderRows();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !drawer.open && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      $("#search").focus();
    }
  });
  window.addEventListener("hashchange", routeFromHash);
}

async function main() {
  try {
    const response = await fetch("catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.items = data.items;
    state.marketplace = data.marketplace;
  } catch (error) {
    $("#rows").innerHTML = `<p class="empty">Could not load catalog.json (${escapeHtml(error.message)}). Run <code>npm run build</code>.</p>`;
    return;
  }
  renderMasthead();
  renderTickets();
  renderKinds();
  renderRows();
  bindEvents();
  routeFromHash();
}

main();
