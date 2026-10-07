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
  const clone = `git clone ${state.marketplace.gitUrl}
export XAILON_RECIPE_PATH="$PWD/xailon-marketplace/${folder}"`;
  return `
    <section class="block">
      <h3>Run it</h3>
      ${commandBox(`xailon run --recipe ${recipe.name}`)}
      <div class="notice notice--spaced">
        <p>Installed recipes appear in <code>xailon recipe list</code> and the Recipes view once your Xailon release loads recipes from plugins. With an older release, point Xailon at a clone instead:</p>
        <div class="snippet-wrap"><pre class="snippet">${escapeHtml(clone)}</pre><button class="copy" type="button" data-copy="${escapeHtml(clone)}">Copy</button></div>
      </div>
    </section>
    <section class="block flow-block" data-workflow="${escapeHtml(item.name)}" data-recipe="${escapeHtml(recipe.name)}">
      <h3>How the team works</h3>
      <p class="flow-loading">Reading the recipe's definitions…</p>
    </section>`;
}

// Workflows are drawn from site/workflows.json, which the build derives from each recipe's
// orchestrator and sub-recipe definitions. Fetched once, the first time a recipe opens.
let workflowsRequest = null;

function loadWorkflows() {
  workflowsRequest ??= fetch("workflows.json", { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  workflowsRequest.catch(() => {
    workflowsRequest = null;
  });
  return workflowsRequest;
}

const fileName = (file) => file.replace(/^_workspace\//, "");
// Lets long workspace file names wrap at their underscores.
const breakable = (file) => escapeHtml(fileName(file)).replace(/_/g, "_<wbr>");
const workspaceOrder = (file) => Number(file.match(/_workspace\/(\d+)/)?.[1] ?? -1);

function finalOutput(workflow) {
  const files = workflow.roles.flatMap((role) => role.outputs);
  return files.sort((a, b) => workspaceOrder(b) - workspaceOrder(a))[0] ?? null;
}

const PATTERN_ICONS = {
  supervisor: "M12 4v5M12 9l-6 6M12 9l6 6M12 9v6",
  pipeline: "M4 12h4M10 12h4M16 12h4",
  parallel: "M5 8h14M5 16h14",
  synthesis: "M5 6l7 6-7 6M12 12h7",
  review: "M17 7a7 7 0 1 0 2 5M17 3v4h-4",
  exchange: "M5 9h14l-3-3M19 15H5l3 3",
};

function patternCard(pattern) {
  const icon = PATTERN_ICONS[pattern.key] ?? PATTERN_ICONS.pipeline;
  return `<li class="pattern pattern--${escapeHtml(pattern.key)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg>
    <span><b>${escapeHtml(pattern.label)}</b>${escapeHtml(pattern.detail)}</span>
  </li>`;
}

function flowNode(role, stage) {
  const output = role.outputs[0];
  return `<button class="flow__node${role.lead ? " is-lead" : ""}" type="button" data-role="${escapeHtml(role.id)}" aria-pressed="false">
    <span class="flow__stage-no">${pad(stage + 1)}</span>
    <span class="flow__name">${escapeHtml(role.name)}${role.lead ? `<span class="flow__tag">Lead</span>` : ""}</span>
    ${output ? `<span class="flow__out">${escapeHtml(fileName(output))}${role.outputs.length > 1 ? ` +${role.outputs.length - 1}` : ""}</span>` : ""}
  </button>`;
}

function workflowMarkup(workflow) {
  const lead = workflow.roles.find((role) => role.lead);
  const specialists = workflow.roles.length - 1;
  const stages = Math.max(...workflow.roles.map((role) => role.stage)) + 1;
  const count = (kind) => workflow.handoffs.filter((handoff) => handoff.kind === kind).length;
  const deliverable = finalOutput(workflow);
  const rows = Array.from({ length: stages }, (_, stage) => workflow.roles.filter((role) => role.stage === stage));

  return `
    <h3>How the team works</h3>
    <p class="flow-headline">${escapeHtml(workflow.headline)}</p>
    <ul class="flow-stats">
      <li><b>${workflow.roles.length}</b> roles</li>
      <li><b>${stages}</b> stages</li>
      <li><b>${count("forward")}</b> handoffs</li>
      ${count("feedback") ? `<li><b>${count("feedback")}</b> send-backs</li>` : ""}
      ${count("exchange") ? `<li><b>${count("exchange") / 2}</b> exchanges</li>` : ""}
    </ul>

    <ol class="runtime" aria-label="How Xailon runs this recipe">
      <li><b>You</b><span>Ask for the result</span></li>
      <li><b>${escapeHtml(lead.name)}</b><span>Calls ${specialists} specialists as sub-recipes</span></li>
      <li><b>Specialists</b><span>Write to <code>_workspace/</code> and report back</span></li>
      <li><b>Deliverable</b><span>${deliverable ? `<code>${breakable(deliverable)}</code>` : "The lead's synthesis"}</span></li>
    </ol>

    <ul class="patterns">${workflow.patterns.map(patternCard).join("")}</ul>

    <div class="flow" data-flow>
      <svg class="flow__arcs" aria-hidden="true"></svg>
      <ol class="flow__stages" aria-label="Roles by stage">
        ${rows.map((row, stage) => `<li class="flow__row${row.length > 1 ? " is-parallel" : ""}">${row.map((role) => flowNode(role, stage)).join("")}</li>`).join("")}
      </ol>
    </div>
    <ul class="flow-legend" aria-hidden="true">
      <li class="flow-legend__forward">Hands work forward</li>
      ${count("feedback") ? `<li class="flow-legend__feedback">Sends work back</li>` : ""}
      ${count("exchange") ? `<li class="flow-legend__exchange">Trades both ways</li>` : ""}
    </ul>
    <div class="flow-detail" aria-live="polite"></div>
    <p class="flow-note">Handoffs are what each role's definition says it passes on. At run time they travel through the lead and the shared <code>_workspace/</code> folder.${
      workflow.unmatched.length
        ? ` The definitions also mention ${workflow.unmatched.map((name) => `<q>${escapeHtml(name)}</q>`).join(", ")}, which ${workflow.unmatched.length === 1 ? "is not a role" : "are not roles"} in this recipe.`
        : ""
    }</p>`;
}

function roleDetail(workflow, id) {
  const role = workflow.roles.find((candidate) => candidate.id === id);
  const name = (other) => escapeHtml(workflow.roles.find((candidate) => candidate.id === other)?.name ?? other);
  const group = (title, handoffs, side) =>
    handoffs.length
      ? `<h4>${title}</h4><ul>${handoffs
          .map((handoff) => `<li><b>${name(handoff[side])}</b>${handoff.what ? `<span>${escapeHtml(handoff.what)}</span>` : ""}</li>`)
          .join("")}</ul>`
      : "";
  const out = workflow.handoffs.filter((handoff) => handoff.from === id);
  const into = workflow.handoffs.filter((handoff) => handoff.to === id);
  const of = (list, kind) => list.filter((handoff) => handoff.kind === kind);
  return `
    <p class="flow-detail__title">${escapeHtml(role.name)}${role.lead ? `<span class="flow__tag">Lead</span>` : ""}</p>
    ${role.summary ? `<p class="flow-detail__summary">${escapeHtml(role.summary)}.</p>` : ""}
    ${role.outputs.length ? `<p class="flow-detail__files">Writes ${role.outputs.map((file) => `<code>${escapeHtml(fileName(file))}</code>`).join(" ")}</p>` : ""}
    <div class="flow-detail__groups">
      ${group("Receives from", of(into, "forward"), "from")}
      ${group("Hands to", of(out, "forward"), "to")}
      ${group("Trades with", of(out, "exchange"), "to")}
      ${group("Sends back to", of(out, "feedback"), "to")}
      ${group("Gets work back from", of(into, "feedback"), "from")}
    </div>`;
}

const SVG = "http://www.w3.org/2000/svg";

// Arcs are measured from the laid-out nodes, so names can wrap and the drawer can resize.
function drawArcs(flow, workflow) {
  const svg = flow.querySelector(".flow__arcs");
  const box = flow.getBoundingClientRect();
  const list = flow.querySelector(".flow__stages").getBoundingClientRect();
  if (box.width === 0) return;
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  const stageOf = new Map(workflow.roles.map((role) => [role.id, role.stage]));
  const anchor = new Map();
  for (const node of flow.querySelectorAll(".flow__node")) {
    const rect = node.getBoundingClientRect();
    const siblings = [...node.parentElement.children];
    const shift = (siblings.indexOf(node) - (siblings.length - 1) / 2) * 10;
    anchor.set(node.dataset.role, rect.top - box.top + rect.height / 2 + shift);
  }
  const right = list.right - box.left;
  const left = list.left - box.left;
  const room = { right: box.width - right - 6, left: left - 6 };

  const markers = ["forward", "feedback", "exchange"]
    .map(
      (kind) =>
        `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow arrow--${kind}" d="M0 0L10 5L0 10z"/></marker>`,
    )
    .join("");
  const paths = workflow.handoffs
    .filter((handoff) => handoff.kind !== "exchange" || handoff.from < handoff.to)
    .map((handoff) => {
      const span = Math.abs(stageOf.get(handoff.to) - stageOf.get(handoff.from));
      const side = handoff.kind === "forward" ? 1 : -1;
      const x = side === 1 ? right : left;
      const reach = Math.min(room[side === 1 ? "right" : "left"], 14 + 16 * Math.max(span, 1));
      const y1 = anchor.get(handoff.from) - 5 * side;
      const y2 = anchor.get(handoff.to) + 5 * side;
      const bend = x + side * reach;
      const both = handoff.kind === "exchange" ? ` marker-start="url(#arrow-exchange)"` : "";
      return `<path class="arc arc--${handoff.kind}" data-from="${escapeHtml(handoff.from)}" data-to="${escapeHtml(handoff.to)}" d="M${x} ${y1}C${bend} ${y1} ${bend} ${y2} ${x} ${y2}" marker-end="url(#arrow-${handoff.kind})"${both}/>`;
    })
    .join("");
  svg.innerHTML = `<defs>${markers}</defs>${paths}`;
  highlight(flow, flow.dataset.focus || flow.dataset.selected);
}

function highlight(flow, id) {
  flow.classList.toggle("has-focus", Boolean(id));
  const linked = new Set([id]);
  for (const arc of flow.querySelectorAll(".arc")) {
    const on = arc.dataset.from === id || arc.dataset.to === id;
    arc.classList.toggle("is-on", on);
    if (on) linked.add(arc.dataset.from).add(arc.dataset.to);
  }
  for (const node of flow.querySelectorAll(".flow__node")) {
    node.classList.toggle("is-linked", linked.has(node.dataset.role));
    node.classList.toggle("is-current", node.dataset.role === id);
  }
}

// The lead's details show first, but nothing is dimmed until someone picks a role.
function select(block, workflow, id, { quiet = false } = {}) {
  const flow = block.querySelector("[data-flow]");
  if (!quiet) flow.dataset.selected = id;
  for (const node of flow.querySelectorAll(".flow__node")) node.setAttribute("aria-pressed", String(!quiet && node.dataset.role === id));
  block.querySelector(".flow-detail").innerHTML = roleDetail(workflow, id);
  highlight(flow, flow.dataset.selected);
}

async function renderWorkflow(block) {
  let workflow;
  try {
    workflow = (await loadWorkflows())[block.dataset.workflow]?.[block.dataset.recipe];
  } catch (error) {
    block.querySelector(".flow-loading").textContent = `Could not load workflows.json (${error.message}).`;
    return;
  }
  if (!block.isConnected) return;
  if (!workflow) {
    block.remove();
    return;
  }
  block.innerHTML = workflowMarkup(workflow);
  const flow = block.querySelector("[data-flow]");
  const focus = (id) => {
    if (id) flow.dataset.focus = id;
    else delete flow.dataset.focus;
    highlight(flow, id || flow.dataset.selected);
  };
  flow.addEventListener("click", (event) => {
    const node = event.target.closest(".flow__node");
    if (node) select(block, workflow, node.dataset.role);
  });
  flow.addEventListener("pointerover", (event) => focus(event.target.closest(".flow__node")?.dataset.role));
  flow.addEventListener("pointerleave", () => focus(null));
  flow.addEventListener("focusin", (event) => focus(event.target.closest(".flow__node")?.dataset.role));
  flow.addEventListener("focusout", () => focus(null));
  select(block, workflow, workflow.roles.find((role) => role.lead).id, { quiet: true });
  new ResizeObserver(() => drawArcs(flow, workflow)).observe(flow);
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
  const workflowBlock = $("#drawer-body [data-workflow]");
  if (workflowBlock) renderWorkflow(workflowBlock);
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
