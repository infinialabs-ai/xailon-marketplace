// Reads a recipe's orchestrator and sub-recipe definitions and works out how its team hands
// work around: who leads, which role passes what to whom, where reviews send work back, and
// which workflow patterns that adds up to. The catalog page draws the result.
//
// Every role's instructions end with a "Team Communication Protocol" list of
// "**To X**: …" / "**From X**: …" lines, and most name the `_workspace/NN_*.md` file they
// write. The numbering orients the handoffs; the stages come from what each role consumes.

import path from "node:path";
import YAML from "yaml";

const STOP = new Set(["the", "a", "an", "agent", "team", "role", "specialist"]);
const BROADCAST = /\b(all|every|each|individual|entire|whole)\b.*\b(members?|agents?|team|roles?|specialists?)\b|^(team|everyone)$/i;
const LEAD = /^(leader|lead|team lead(er)?|orchestrator|coordinator|main agent|supervisor)$/i;
// Handoffs that send work back for another pass rather than forward to the next stage.
const FEEDBACK =
  /\b(fix(es)?|revis\w*|rework|feedback|bugs?|correct\w*|reject\w*|re-?verif\w*|re-?review|send(s)? back|improvement requests?|change requests?|additional analysis)\b/i;

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t));
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function outputsOf(instructions) {
  const files = new Set();
  for (const m of instructions.matchAll(/Save (?:as|to|it to|results? to)[^`\n]*`(_workspace\/[^`]+)`/gi)) files.add(m[1]);
  for (const m of instructions.matchAll(/^#{2,4} [^\n]*`(_workspace\/[^`]+)`/gm)) files.add(m[1]);
  if (files.size === 0) {
    const first = instructions.split(/^## Output/m)[1]?.match(/`(_workspace\/[^`]+)`/)?.[1];
    if (first) files.add(first);
  }
  return [...files];
}

function loadRoles(read, recipe) {
  const leadDoc = YAML.parse(read(`recipes/${recipe}.yaml`));
  const roles = [{ id: recipe, lead: true, doc: leadDoc }];
  for (const sub of leadDoc.sub_recipes ?? []) {
    const rel = path.posix.join("recipes", sub.path.replace(/^\.\//, ""));
    roles.push({ id: path.posix.basename(rel).replace(/\.(ya?ml|json)$/, ""), lead: false, doc: YAML.parse(read(rel)) });
  }
  for (const role of roles) {
    const instructions = role.doc.instructions ?? "";
    const [h1Name, h1Long] = (instructions.match(/^# (.+)$/m)?.[1] ?? "").split(/\s+[—–-]\s+/);
    // Headings name the role ("QA Engineer"); the lead recipe's title names the whole harness.
    role.name = h1Name || titleCase(role.doc.title ?? role.id.replace(/-/g, " "));
    role.aliases = [role.id.replace(/-/g, " "), role.doc.title, h1Name, h1Long].filter(Boolean).map(norm);
    role.outputs = outputsOf(instructions);
    const numbers = role.outputs.map((f) => Number(f.match(/_workspace\/(\d+)/)?.[1])).filter((n) => !Number.isNaN(n));
    role.order = numbers.length ? Math.min(...numbers) : null;
  }
  return roles;
}

// Names in the protocol drift from the role titles ("the reviewer", "Frontend"), so match on
// the exact alias first, then on the role whose name shares most of the words.
function resolver(roles) {
  const one = (raw) => {
    const name = raw.replace(/\(.*?\)/g, "").replace(/^(the|a|an)\s+/i, "").trim();
    if (BROADCAST.test(name)) return "*";
    if (LEAD.test(name)) return roles[0];
    const exact = roles.find((role) => role.aliases.includes(norm(name)));
    if (exact) return exact;
    const words = tokens(name);
    if (words.length === 0) return null;
    let best = null;
    let bestScore = 0;
    let tie = false;
    for (const role of roles) {
      const known = new Set(role.aliases.flatMap(tokens));
      const score = words.filter((w) => known.has(w) || known.has(w.replace(/s$/, ""))).length / words.length;
      if (score > bestScore) [best, bestScore, tie] = [role, score, false];
      else if (score === bestScore && score > 0) tie = true;
    }
    return bestScore >= 0.5 && !tie ? best : null;
  };
  return (raw) => {
    const whole = one(raw);
    if (whole) return [whole];
    const parts = raw.split(/\s*(?:,|\/|&|\band\b|\bor\b)\s*/i).filter(Boolean);
    return parts.length > 1 ? parts.map(one).filter(Boolean) : [];
  };
}

function collectHandoffs(roles) {
  const resolve = resolver(roles);
  const edges = new Map();
  const unmatched = new Set();
  const add = (from, to, text, side) => {
    if (from === to) return;
    const key = `${from.id}>${to.id}`;
    const edge = edges.get(key) ?? { from: from.id, to: to.id, give: "", take: "" };
    edge[side] ||= text;
    edges.set(key, edge);
  };
  for (const role of roles) {
    const section =
      (role.doc.instructions ?? "").split(/^## Team Communication Protocol[^\n]*$/m)[1]?.split(/^## /m)[0] ?? "";
    for (const m of section.matchAll(/^\s*- \*\*(To|From|Send to|Receive from) ([^*]+?):?\*\*:?\s*(.*)$/gim)) {
      const outgoing = /^(to|send)/i.test(m[1]);
      const text = m[3].replace(/\s+/g, " ").trim();
      const found = resolve(m[2]);
      if (found.length === 0) unmatched.add(m[2].replace(/^(the|a|an)\s+/i, "").trim());
      for (const other of found) {
        for (const peer of other === "*" ? roles.filter((r) => r !== role) : [other]) {
          if (outgoing) add(role, peer, text, "give");
          else add(peer, role, text, "take");
        }
      }
    }
  }
  return { edges: [...edges.values()], unmatched: [...unmatched] };
}

// forward: the next stage builds on it. feedback: a review sends work back.
// exchange: two roles feed each other with no order between them.
function classify(roles, edges) {
  const byId = new Map(roles.map((role) => [role.id, role]));
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    const backwards = from.order != null && to.order != null && to.order < from.order;
    edge.kind = backwards || FEEDBACK.test(`${edge.give} ${edge.take}`) ? "feedback" : "forward";
  }
  const key = (a, b) => `${a}>${b}`;
  const index = new Map(edges.map((edge) => [key(edge.from, edge.to), edge]));
  for (const edge of edges) {
    const back = index.get(key(edge.to, edge.from));
    if (edge.kind === "forward" && back?.kind === "forward") {
      const from = byId.get(edge.from).order;
      const to = byId.get(edge.to).order;
      if (from == null || to == null || from === to) edge.kind = back.kind = "exchange";
    }
  }
  // Anything still circular is an exchange too, so stages can be layered.
  const next = new Map(roles.map((role) => [role.id, []]));
  for (const edge of edges) if (edge.kind === "forward") next.get(edge.from).push(edge);
  const state = new Map();
  const visit = (id) => {
    state.set(id, "open");
    for (const edge of next.get(id)) {
      if (state.get(edge.to) === "open") edge.kind = "exchange";
      else if (!state.has(edge.to)) visit(edge.to);
    }
    state.set(id, "done");
  };
  for (const role of [...roles].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))) if (!state.has(role.id)) visit(role.id);
}

function layer(roles, edges) {
  const inputs = new Map(roles.map((role) => [role.id, []]));
  for (const edge of edges) if (edge.kind === "forward") inputs.get(edge.to).push(edge.from);
  const stage = new Map();
  const depth = (id) => {
    if (!stage.has(id)) stage.set(id, Math.max(-1, ...inputs.get(id).map(depth)) + 1);
    return stage.get(id);
  };
  for (const role of roles) role.stage = depth(role.id);
}

const list = (names) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

function patterns(roles, edges) {
  const name = new Map(roles.map((role) => [role.id, role.name]));
  const lead = roles[0];
  const stages = Math.max(...roles.map((role) => role.stage)) + 1;
  const forward = edges.filter((edge) => edge.kind === "forward");
  const feedback = edges.filter((edge) => edge.kind === "feedback");
  const exchange = edges.filter((edge) => edge.kind === "exchange" && edge.from < edge.to);
  const found = [];

  const position =
    lead.stage === 0 ? "frames the work first" : lead.stage === stages - 1 ? "combines the results last" : `works at stage ${lead.stage + 1}`;
  found.push({
    key: "supervisor",
    label: "Lead and specialists",
    detail: `${lead.name} runs the recipe, calls ${roles.length - 1} specialists as sub-recipes, and ${position}.`,
  });

  const parallel = Array.from({ length: stages }, (_, i) => roles.filter((role) => role.stage === i)).filter((r) => r.length > 1);
  if (parallel.length) {
    found.push({
      key: "parallel",
      label: "Parallel stage",
      detail: parallel.map((group) => `${list(group.map((role) => role.name))} work side by side`).join("; ") + ".",
    });
  }
  if (stages >= 3) {
    found.push({
      key: "pipeline",
      label: "Sequential pipeline",
      detail: `${stages} stages; each one builds on what the earlier stages hand over.`,
    });
  }

  const last = roles.filter((role) => role.stage === stages - 1);
  const synthesis = last.length === 1 ? forward.filter((edge) => edge.to === last[0].id) : [];
  if (synthesis.length >= 3) {
    found.push({
      key: "synthesis",
      label: "Synthesis",
      detail: `${last[0].name} pulls together work from ${list(synthesis.map((edge) => name.get(edge.from)))}.`,
    });
  }

  if (feedback.length) {
    const reviewers = [...new Set(feedback.map((edge) => edge.from))];
    found.push({
      key: "review",
      label: "Review loop",
      detail:
        reviewers
          .map((id) => `${name.get(id)} sends work back to ${list(feedback.filter((e) => e.from === id).map((e) => name.get(e.to)))}`)
          .join("; ") + ".",
    });
  }
  if (exchange.length) {
    found.push({
      key: "exchange",
      label: "Peer exchange",
      detail: `${exchange.map((edge) => `${name.get(edge.from)} ⇄ ${name.get(edge.to)}`).join(", ")} trade work both ways.`,
    });
  }

  const shape =
    exchange.length >= 2 ? "Collaborative team" : parallel.length ? "Fan-out and fan-in" : stages >= 3 ? "Sequential pipeline" : "Lead with specialists";
  return { headline: feedback.length ? `${shape} with a review loop` : shape, patterns: found };
}

// Descriptions open with the role's long title ("Tradeoff Evaluator. Performs …"); keep what it does.
function summaryOf(description = "") {
  const sentences = description.split(/(?<=\.)\s+/);
  const lead = sentences.length > 1 && sentences[0].split(/\s+/).length <= 6 ? sentences[1] : sentences[0];
  return (lead ?? "").replace(/\.$/, "");
}

export function recipeWorkflow(read, recipe) {
  const roles = loadRoles(read, recipe);
  const { edges, unmatched } = collectHandoffs(roles);
  classify(roles, edges);
  layer(roles, edges);
  const { headline, patterns: found } = patterns(roles, edges);
  const ordered = [...roles].sort((a, b) => a.stage - b.stage || (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  const rank = new Map(ordered.map((role, i) => [role.id, i]));
  return {
    headline,
    patterns: found,
    roles: ordered.map((role) => ({
      id: role.id,
      name: role.name,
      ...(role.lead ? { lead: true } : {}),
      stage: role.stage,
      outputs: role.outputs,
      summary: summaryOf(role.doc.description),
    })),
    handoffs: edges
      .sort((a, b) => rank.get(a.from) - rank.get(b.from) || rank.get(a.to) - rank.get(b.to))
      .map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind, what: edge.give || edge.take })),
    unmatched,
  };
}
