# Agent Loop Evolution

Updated: 2026-06-27

This project already has an agent loop, tools, approvals, memory, browser, MCP,
and verification pieces. The next gap is the orchestration layer: the model is
too often handed a large flat tool list and asked to choose its own route.

The OpenAI Codex codebase is useful here because its open layer is not model
reasoning internals; it is the harness around the model:

- `codex-rs/core/src/tools/spec_plan.rs`: builds a per-turn tool plan.
- `codex-rs/core/src/tools/router.rs`: owns model-visible specs and dispatch.
- `codex-rs/core/src/tools/registry.rs`: wraps tool lifecycle, hooks, telemetry,
  and result shaping.
- `codex-rs/core/src/session/*`: keeps session, active turn, pending input, and
  resumable work separate from one model loop.

## Current Diagnosis

The current loop is functional but still too much like:

```text
user request -> prompt -> model chooses from many tools -> execute -> observe -> repeat
```

The target shape is closer to:

```text
Session -> Turn -> StepContext -> ToolRouter -> Tool lifecycle -> Observation -> Next Step
```

The first useful cut is not a full rewrite. It is a Codex-style `ToolRouter`
that reduces default tool noise and makes specialized tools discoverable only
when the task calls for them.

## Phase 1: Tool Router

Implement a small TypeScript adaptation of Codex `ToolExposure`:

- `direct`: visible to the model by default.
- `deferred`: searchable through `tool.search`, then unlocked for later model
  calls in the same run.
- `hidden`: registered for internal/runtime dispatch but not shown to the model.

The model-visible default set should stay compact:

```text
agent.diagnose
agent.bootstrap.check
workspace.inspect
project.index
file.locate
ui.trace_from_page
file.list
file.read
file.search
git.status
git.diff
browser.open
browser.inspect
file.replace
file.mutation
patch.apply
shell.run.prepare
tool.search
```

Specialized tools should start deferred:

```text
browser.wait_and_inspect
browser.query
devtools.*
jsx.find_text
symbol.find_references
prepare-only mutation tools
git.mutation.prepare
shell.command.prepare
patch.prepare
```

`tool.search` returns the matched tool names, descriptions, and argument hints.
Common Chinese task phrasing is indexed too, so non-ASCII queries for screenshot or style can unlock the relevant DevTools tools. In `strictPrepare` runs, prepare-only tools are visible immediately to avoid blocking approval-first workflows.

MCP tools may stay directly available for now because their registry already
has separate connection and fallback behavior. A later phase can move low-signal
MCP tools behind the same discovery layer.

## Phase 2: Step Boundary

After the router is stable, split the oversized loop into step-sized units:

```text
createTurnRuntime
runLoopStep
buildToolRouterForStep
callStepModel
dispatchStepTools
applyPostToolFeedback
maybeCompactStepContext
```

This should be a rewrite boundary. If a feature needs more than one more
condition in the main loop, move it into one of those step modules.

## Phase 3: Tool Lifecycle Hooks

Adapt the Codex registry shape:

- `preToolUse`: reject unsafe or incoherent calls before execution.
- `execute`: run the existing tool implementation.
- `postToolUse`: add feedback, update run state, pin facts, or force validation.

This is where approval, sandbox policy, repeated failures, write-after-read
rules, and post-write verification should converge.

## Phase 4: Resumable Turn Protocol

Approvals should pause and resume the same logical turn:

```text
tool call requests approval
turn checkpoint is saved
user approves or rejects
tool result is injected
same turn continues
```

The existing shell resume implementation is a good seed. The goal is to make it
generic for shell, file, git, and permission requests.

## Phase 5: Prompt Encoding Cleanup

Several core comments and runtime strings are mojibake in the current tree.
Any such string that reaches the model becomes prompt pollution. Clean these
incrementally when touching a file, and prefer ASCII for new runtime messages
unless Chinese is intentionally model-visible.
