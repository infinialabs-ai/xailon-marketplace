// index.mjs
var events = Object.freeze([
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "TurnStart",
  "Stop",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "BeforeReadFile",
  "AfterFileEdit",
  "BeforeShellExecution",
  "AfterShellExecution",
  "ApprovalRequested",
  "ApprovalDecided",
  "PreCompact",
  "PostCompact",
  "ModelSwitch",
  "Error",
  "SubagentStart",
  "SubagentStop"
]);
var namePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
function defineMod(mod) {
  if (!mod || typeof mod.name !== "string" || !namePattern.test(mod.name) || mod.name.includes(".."))
    throw new Error("Invalid mod name");
  if (mod.description !== void 0 && typeof mod.description !== "string")
    throw new Error("Description must be text");
  const panels = mod.panels ?? [];
  if (!Array.isArray(panels) || panels.length > 16)
    throw new Error("A mod supports at most 16 panels");
  const ids = /* @__PURE__ */ new Set();
  for (const panel of panels) {
    if (typeof panel.id !== "string" || !namePattern.test(panel.id) || panel.id.includes("..") || ids.has(panel.id) || typeof panel.title !== "string" || !panel.title.trim() || Buffer.byteLength(panel.title) > 120 || typeof panel.markdown !== "string" || Buffer.byteLength(panel.markdown) > 65536)
      throw new Error("Invalid or duplicate mod panel");
    ids.add(panel.id);
  }
  for (const [event, hook] of Object.entries(mod.hooks ?? {})) {
    if (!events.includes(event) || typeof hook !== "function")
      throw new Error(`Invalid lifecycle hook: ${event}`);
  }
  return mod;
}
function describeMod(mod) {
  defineMod(mod);
  return {
    api_version: 1,
    name: mod.name,
    description: mod.description ?? "",
    panels: mod.panels ?? [],
    events: Object.keys(mod.hooks ?? {})
  };
}
async function dispatch(mod, context) {
  defineMod(mod);
  if (!context || !events.includes(context.event) || typeof context.session_id !== "string" || !context.payload || typeof context.payload !== "object" || Array.isArray(context.payload))
    throw new Error("Invalid hook context");
  const result = await mod.hooks?.[context.event]?.(context) ?? {};
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Hook must return an object or nothing");
  const allowed = /* @__PURE__ */ new Set([
    "decision",
    "reason",
    "additional_context",
    "updated_input"
  ]);
  if (Object.keys(result).some((key) => !allowed.has(key)) || result.decision !== void 0 && !["allow", "deny", "ask"].includes(result.decision) || ["reason", "additional_context"].some(
    (key) => result[key] !== void 0 && typeof result[key] !== "string"
  ))
    throw new Error("Invalid hook response");
  if (Buffer.byteLength(JSON.stringify(result)) > 1048576)
    throw new Error("Hook response exceeds 1 MiB");
  return result;
}
async function runMod(mod) {
  try {
    if (process.argv.includes("--describe")) {
      process.stdout.write(`${JSON.stringify(describeMod(mod))}
`);
      return;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 1048576) throw new Error("Hook input exceeds 1 MiB");
      chunks.push(chunk);
    }
    const result = await dispatch(
      mod,
      JSON.parse(Buffer.concat(chunks).toString("utf8"))
    );
    process.stdout.write(`${JSON.stringify(result)}
`);
  } catch {
    process.stderr.write(
      "Xailon mod failed: invalid input, response, or handler failure.\n"
    );
    process.exitCode = 2;
  }
}

// examples/team-policy.ts
await runMod(
  defineMod({
    name: "team-policy",
    description: "A shared development checklist and lifecycle context.",
    panels: [
      {
        id: "checklist",
        title: "Team checklist",
        markdown: "| Before shipping | Check |\n|---|---|\n| Tests | Run the affected suite |\n| Review | Inspect the diff |\n\n- [ ] Document user-facing changes\n- [ ] Keep credentials out of commits"
      }
    ],
    hooks: {
      SessionStart: () => ({
        additional_context: "Run the affected tests and inspect the diff before shipping."
      }),
      PreToolUse: (context) => context.tool_name?.includes("deploy") ? { decision: "ask", reason: "Review deployment changes first." } : {}
    }
  })
);
