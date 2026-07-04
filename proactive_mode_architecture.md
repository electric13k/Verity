# Verity: Proactive Mode & Digital Brain Architecture

This document outlines the architectural expansion for **Proactive Mode**, a large-scale, autonomous orchestration system integrated with a **Digital Brain** for long-term memory and a **Goal-Driven Scheduler** for persistent execution.

---

## 1. Proactive Mode: The Autonomous Layer
Proactive Mode evolves the current task-based orchestration into a continuous, goal-driven pursuit. It operates on a "Horizon" principle, where high-level objectives are broken down into weeks, days, and hours of focused execution.

### Key Components:
- **Goal Manager**: A hierarchical system for defining, tracking, and decomposing "North Star" objectives.
- **Horizon Scheduler**: A time-blocked execution engine that allocates specific hours per day to specific goals.
- **Autonomous Loop**: A self-correcting cycle that evaluates progress at the end of each session and adjusts the plan for the next.

---

## 2. The Digital Brain (Knowledge Vault)
Instead of transient task history, the Digital Brain provides a persistent, structured knowledge base using a local-first Markdown "Vault" (Obsidian-compatible).

### Features:
- **Project Indexing**: Every orchestration result is distilled into structured Markdown notes.
- **Semantic Linking**: Automatic cross-referencing between related tasks, goals, and insights.
- **RAG Integration**: The orchestrator can "consult" the vault before starting any new task to leverage previous findings.

---

## 3. Blind Orchestration Protocol
A core requirement is that sub-agents (LLMs, tools) remain unaware of their position in the hierarchy. This prevents "meta-reasoning" loops and ensures focus.

### Implementation:
- **Input Sanitization**: The Master Orchestrator strips all mentions of "orchestration," "other agents," or "master plans" from prompts sent to sub-agents.
- **Persona Isolation**: Each sub-agent is given a specific, narrow persona (e.g., "Data Analyst," "Code Auditor") without context of the larger goal.
- **Output Re-contextualization**: The Orchestrator re-maps sub-agent outputs back to the master plan internally.

---

## 4. Technical Roadmap

### Phase 1: Persistence & Vault (Week 1-2)
- Implement `VaultService` to manage local Markdown files.
- Create automated "Distillation" logic to save task results into the Vault.
- Update UI to include a "Brain Explorer" view.

### Phase 2: Goal & Scheduler (Week 3-4)
- Build the `GoalRegistry` and `SchedulerService`.
- Implement Cron-based triggers for autonomous sessions.
- Add "Proactive Dashboard" for goal tracking and time allocation.

### Phase 3: Blind Protocol & Scaling (Week 5-6)
- Implement the `PromptSanitizer` middleware.
- Scale the Orchestrator to handle multi-day, multi-step dependencies.
- Integrate Vault-based RAG for long-term context injection.

---

## 5. Data Schema (Proactive)

| Entity | Storage | Description |
| :--- | :--- | :--- |
| **Goal** | SQLite | High-level objective with status and priority. |
| **Schedule** | SQLite | Time-blocks and recurrence rules for goal pursuit. |
| **Vault Note** | Markdown | Distilled knowledge, insights, and project logs. |
| **Session** | SQLite | Execution logs for a specific scheduled block. |

---

## 6. Blind Orchestration Logic
```typescript
interface SanitizedRequest {
  role: string;
  instruction: string;
  context: string; // Stripped of orchestration metadata
}

function sanitize(masterPlan: Plan, step: Step): SanitizedRequest {
  // Logic to transform a master plan step into a 
  // standalone instruction for a "blind" agent.
}
```
