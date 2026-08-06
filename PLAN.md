# PLAN.md — Wake

**Wake** — the trail something leaves as it moves. Agents move; you read the wake.

A personal tool that sits between Linear and Notion/Obsidian: a knowledge store with issue and project tracking, operated primarily by coding agents over MCP, read by a human through a beautiful local UI. Conversation threads attach to anything in the graph. Loops (recurring automations) run from the workspace. Multiplayer "spaces" are a future direction the data model must not preclude.

---

## 1. Vision & Positioning

**The gap:** Linear is overbuilt for one person and its primitive (the human-authored ticket) is wrong for agent-driven work. Notion/Obsidian store knowledge but have no opinion about *work* — no status, no issues, no execution. Slack-style conversation is missing from both.

**The inversion:** When agents do the work, the *record* matters more than the *promise*. Status is **derived from activity**, not manually updated. Nobody drags cards.

**Primary user story (v1):** Coding agents write to the workspace via MCP — documenting work, updating issue/project state, maintaining docs (e.g., styles documentation, feature/flow docs). The human's only reason to open the app is to **read**: browse docs, scan statuses, understand where projects stand.

**Secondary (later):** Threads attached to graph nodes; loops that run the operation (code health, triage, changelogs, business automations); shareable spaces with outside collaborators.

---

## 2. Core Principles

1. **Agent-native data layer.** Plain, open, file-friendly storage. Agents speak files and simple APIs fluently; no proprietary lock-in. The differentiation is the reading layer, not the database.
2. **Derived vs. authored content.** Two write disciplines on one data plane:
   - *Authored* (human or agent as author): specs, decisions, docs, comments. Ground truth; treated as instruction.
   - *Derived* (agent-owned exhaust): statuses, summaries, changelogs, activity logs. Regenerated from reality; humans never hand-edit derived content (that's how status goes stale).
3. **Node vs. placement.** A node is the content object (doc, issue, image, decision). A placement is its context in a space: local threads, local status overlays, annotations. Content can be shared; conversation stays local. (Analogy: git objects vs. refs.)
4. **Status is computed.** An issue's state should be inferable from linked activity (commits, agent runs, thread resolutions) wherever possible, with explicit state transitions as the fallback.
5. **Spaces are context boundaries.** Later, an agent invited to a space sees exactly that graph and nothing else. Design the model now so this is structural, not policy.
6. **Human as reader first.** Optimize the UI for comprehension: dashboards, timelines, rendered docs. Writing is possible but secondary.

---

## 3. Data Model

### 3.1 Node types (v1)

| Type | Purpose | Authored/Derived fields |
|---|---|---|
| `project` | Container of intent; has a living status | Authored: brief, goals. Derived: `status.md`, activity summary |
| `issue` | Unit of work | Authored: description, acceptance notes. Derived: state, changelog, linked activity |
| `doc` | Knowledge (feature docs, flows, style guides) | Authored body; optional derived "freshness" metadata |
| `thread` | Conversation attached to any node | Authored messages (human + agent participants) |
| `artifact` | Images, links, files | Immutable blob + authored caption |
| `loop` | A recurring automation definition + its run history | Authored: definition. Derived: run logs |

### 3.2 Shape

- Every node: `id` (ULID), `type`, `title`, `created`, `updated`, `author` (human | agent-name), `tags[]`, `links[]` (typed edges: `relates-to`, `blocks`, `documents`, `discusses`, `produced-by`).
- Issues additionally: `state` (`triage | todo | in-progress | blocked | done | dropped`), `project` ref, `activity[]` (append-only log of events with actor + timestamp).
- Nodes are **space-agnostic**; a future `placement` record maps `(node, space) → {threads, overlays, annotations}`. In v1 there is exactly one implicit space ("home"), but keep the indirection so multiplayer doesn't require a migration.

### 3.3 Storage

- **Files as ground truth:** a git repo. Markdown with YAML frontmatter for docs/issues/projects; JSON/NDJSON for activity logs and thread messages; blobs in `/artifacts`.
  - Suggested layout:
    ```
    /projects/<slug>/project.md
    /projects/<slug>/status.md          # derived, agent-owned
    /projects/<slug>/issues/<id>.md
    /docs/<path>.md
    /threads/<node-id>/<thread-id>.ndjson
    /artifacts/<hash>.<ext>
    /loops/<slug>/loop.md
    /loops/<slug>/runs/<run-id>.log
    ```
- **SQLite index as cache:** rebuilt from files (watcher + full reindex command). Powers search, backlinks, dashboards. Never authoritative; deleting it must be safe.
- Git gives history, diffing, and sync for free; agents can also read/write the repo directly when MCP isn't available.

---

## 4. MCP Server (the primary write interface)

TypeScript, official MCP SDK. Local server exposing the workspace to Claude Code / other agents.

**Tools (v1):**
- `search(query, type?, tags?)` → ranked nodes
- `get_node(id)` / `list(type, filters)`
- `create_node(type, fields)` / `update_node(id, patch)` — patches to *derived* fields by humans should be rejected or flagged
- `set_issue_state(id, state, reason)` — appends to activity log
- `log_activity(node_id, event)` — commits, run results, decisions
- `append_doc(id, section, content)` / `write_doc(path, content)`
- `link(a, b, edge_type)`
- `open_thread(node_id, title)` / `post_message(thread_id, body)` — lets agents ask questions or report into conversations
- `regenerate_status(project_id)` — recompute `status.md` from activity

**Resources:** expose docs and project statuses as MCP resources so agents can pull context cheaply.

**Conventions doc:** ship a `CONVENTIONS.md` in the repo that instructs any agent (even without MCP) how to file work: when to open issues, how to update status, where docs live. The tool should work with a dumb agent and files alone; MCP makes it ergonomic.

---

## 5. Reading UI (the human surface)

Local-first web app (recommend: TypeScript + React + Vite, served by the same process as the MCP server; SQLite via the index).

**v1 views:**
1. **Home ("The Wake"):** what changed since last visit — recent activity across projects, freshly derived statuses, open questions from agents (threads awaiting a human).
2. **Project page:** rendered `status.md` up top, issue list grouped by state, activity timeline, linked docs.
3. **Docs:** rendered markdown with backlinks, graph-aware navigation, good typography (this is where you'll live — make reading styles documentation genuinely pleasant).
4. **Issue page:** description, derived changelog, linked commits/runs, attached threads.
5. **Search / graph:** fast full-text + tag search; simple backlink panel before any fancy graph viz.

**Non-goals for v1 UI:** drag-and-drop boards, sprints, estimates, roadmaps — the Linear overbuild is exactly what's being escaped.

---

## 6. Threads (Phase 3)

- A thread attaches to any node (doc, issue, project, artifact) — conversation about the graph, not floating channels.
- Participants: the human + named agents. Agents post via MCP; the human posts via the UI.
- Threads have `open | resolved` state; resolving a thread can emit an activity event on the parent node (so conversations feed derived status).
- Messages are append-only NDJSON on disk; render with the same markdown pipeline as docs.
- This is the seed of the Slack-replacement layer: knowledge (durable) / conversation (attached) / agent presence (visible) as three linked planes.

## 7. Loops (Phase 4)

Loops > one-off agents. A loop is a recurring or triggered automation defined *in* the workspace and reporting *back into* it.

- **Definition (`loop.md`):** trigger (cron schedule, or event like `issue → blocked`, `commit pushed`), the prompt/instructions, target agent/runtime (e.g., "invoke Claude Code in repo X with this task"), and where output lands (which project, which doc, whether to open issues/threads).
- **Runner:** start dead simple — a scheduler in the server process that shells out to the agent CLI, captures the transcript to `runs/`, and requires the loop to file results via MCP.
- **Starter loops:**
  - *Code health:* nightly lint/test/dep-audit on a repo → files issues, updates a health doc.
  - *Changelog:* summarize the week's activity per project into `status.md` + a digest on Home.
  - *Triage:* sweep `triage` issues, enrich, link related docs, propose states.
  - *Docs freshness:* flag docs whose linked code changed since last doc update.
- **Guardrails:** every run is logged and attributable; loops can open threads to ask the human before destructive actions. Human approval gates are a per-loop setting.

## 8. Spaces & Multiplayer (Phase 5 — design only for now)

Captured so the v1 model doesn't paint us into a corner:

- **Space = atomic unit of collaboration**, with its own membership; identity is portable across spaces (you're just you, in many spaces). Attacks the org-wall assumption of Linear/Slack.
- **Nodes can belong to multiple spaces** via placements. Content shared; threads/overlays local to each space.
- **Write rights:** each node has a *home space* that owns writes; other spaces hold live read references. **Fork-on-write** creates a divergent copy with lineage when a non-home space edits.
- **Edge leakage:** links pointing outside a viewer's space render as nothing, a locked stub, or a request-access affordance — per-space setting. (Backlinks are a permission surface.)
- **Deletion:** "remove from this space" and "delete everywhere" are different verbs.
- **Agents in spaces:** an agent joined to a space reads only that space's graph — structural context boundary. Sharing a project can mean sharing its agent too (collaborators query it directly).
- Sync layer TBD (could start as shared git remotes per space before building a service).

---

## 9. Build Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **0** | Repo scaffold: schema, file layout, `CONVENTIONS.md`, SQLite indexer + watcher, seed script migrating a real project out of Linear | Indexer rebuilds cleanly from files; search works in a REPL |
| **1** | MCP server with the v1 toolset; Claude Code connected and filing real work | An agent completes a task and the issue/state/doc trail appears correctly with zero human edits |
| **2** | Reading UI: Home, Project, Docs, Issue, Search | Daily driver replaces opening Linear |
| **3** | Threads on nodes; agent-posted questions surface on Home | An agent asks a question in a thread, human answers in UI, agent resumes |
| **4** | Loop runner + 2 starter loops (code health, weekly changelog) | Loops run unattended for a week with attributable logs |
| **5** | Spaces design doc + placement-layer refactor plan | Written, reviewed, not necessarily built |

## 10. Tech Recommendations

- **Language:** TypeScript end-to-end.
- **Server:** single local Node process = MCP server + file watcher + HTTP for the UI + loop scheduler.
- **Index:** SQLite (better-sqlite3) + FTS5 for search.
- **UI:** React + Vite; markdown via unified/remark with wiki-link + frontmatter plugins; keep the design system minimal and typographically driven.
- **IDs:** ULIDs. **Edges:** stored in frontmatter, indexed to SQLite.
- **Testing the model early:** before building UI, live in Phase 1 for a week — if the file conventions feel wrong when agents use them, fix the schema while it's cheap.

## 11. Open Questions

1. Exact derived-status algorithm: pure LLM summarization of activity vs. rule-based state inference vs. hybrid (recommend hybrid: rules for state, LLM for prose).
   - *Resolved for v1:* hybrid — the server computes a rule-based rollup; the calling agent (already an LLM) supplies the prose via the `regenerate_status` two-call handshake. No API key in the server.
2. How strictly to reject human edits to derived files — hard block, warning, or overlay model.
   - *Resolved for v1:* MCP tools hard-reject patches to derived fields; raw file edits remain physically possible (files are truth) but CONVENTIONS.md marks them hands-off.
3. Auth story for the eventual multi-device/personal-cloud sync (Tailscale? git remote? hosted later?).
4. Whether threads need real-time transport in v1 of Phase 3 or polling is fine (polling is fine).

## 12. Naming

The tool is **Wake**. Conventions: CLI/binary `wake`, MCP server name `wake`, repo `wake`, the workspace data repo can be `~/wake-space` (or per-user choice). UI title is lowercase "wake". The metaphor should quietly inform copy: the Home view is literally the wake — what's trailed behind the agents since you last looked. Check npm (`wake` is likely squatted — `wake-workspace`, `@connor/wake`, or a scoped org are fine fallbacks) and domain availability before publishing anything public.
