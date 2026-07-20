# verity-9b — training corpus

This tree builds the fine-tuning corpus for **verity-9b**, Verity's own house
model. It teaches an open base model to be *Verity's* assistant — in Verity's
voice, about Verity's own product and behavior — not to imitate any other
assistant.

Everything here is model-layer work per [`docs/MASTER_PLAN.md` §5](../docs/MASTER_PLAN.md).

---

## What verity-9b is

- **Base model:** `empero-ai/Qwythos-9B-v2` (the official empero-ai repo only,
  per §5). verity-9b is a QLoRA fine-tune of that base.
- **Method:** QLoRA (4-bit base + LoRA adapters) so training fits on a single
  **24 GB GPU**. Both the GPU and a Hugging Face token are **user gates** — the
  Verity team supplies neither; the operator provides their own GPU rental and
  their own HF token to pull the base weights. Agents never fetch or invent
  either (a Verity law: secrets are user-supplied).
- **Role:** the default house model behind Chat, Flow, Offices, Brains, and the
  Prompt Optimizer. It is served as GGUF over Ollama nodes on the Compute
  network with temp-0 / seed-7 consensus verification (§5).
- **What it is taught:** Verity's identity and product surfaces, confidence +
  the RRR protocol, the Blind Orchestration Protocol, untrusted-content
  handling, tool/MCP/skill consent, memory (Brains) discipline, calm refusals,
  professional-boundary posture, file grounding, formatting restraint, and the
  degrade-never-die error posture — all as Verity behaves in
  `services/brain/app/*`.

---

## ⚠ Legal provenance stance (read this)

MASTER_PLAN §5 flags a real risk: **training on Anthropic's, OpenAI's, Google's,
or any other lab's system prompts or model outputs may violate their terms of
service** (recency of a leaked prompt does not change its licensing). Two
proprietary frontier system prompts were shown to the orchestrator **as a
structural reference only** — to understand the *categories* of behavior any
serious assistant prompt must cover.

This corpus takes the **safe path** the plan assumes:

1. **Every line here is original Verity content.** No proprietary system-prompt
   text, phrasing, or distinctive wording from Claude, ChatGPT/OpenAI, Gemini,
   or any other model is reproduced. Nothing is paraphrased from another
   assistant's instructions; each behavior is written from Verity's own concepts
   (`bop.py`, `confidence.py`, `refiner.py`, `wrap.py`, the flows/offices/memory
   modules).
2. **verity-9b never identifies as another lab's model.** The only assistant
   identity in the corpus is "Verity" / "verity-9b". Where a user *asks* "are you
   GPT?" the assistant answers in Verity's terms and declines the framing.
   (Verified: `grep` finds zero assistant turns claiming a lab identity.)
3. **The behavioral taxonomy is ours, populated by ours.** We used the general
   observation that any frontier assistant must handle identity, safety,
   tool-use, memory, etc. — but every example is Verity-specific and
   Verity-voiced.
4. **Base weights and any external data must be openly licensed.** Qwythos-9B-v2
   from the official repo; if the mix is ever extended, only open datasets
   (e.g. permissively licensed agent prompts / open SFT mixes) are eligible.

If you extend this corpus, hold the same line: write from Verity's concepts. If a
line ever feels like a paraphrase of a specific other-assistant instruction,
delete it and rewrite from what Verity actually does.

---

## Dataset structure

```
model/
  README.md                         this file
  corpus/                           COMMITTED SOURCES (ground truth)
    system_prompts/
      verity_9b_core.md             primary original Verity system prompt
      flow_conductor.md             role variant — Flow conductor
      flow_worker.md                role variant — Flow worker
      flow_inspector.md             role variant — Flow inspector
      office_autonomy.md            the Office autonomy preamble
    behavioral/                     instruction -> response pairs, by taxonomy area
      01_identity_product.jsonl
      02_confidence_rrr.jsonl
      03_bop.jsonl
      04_wrap_untrusted.jsonl
      05_tools_mcp_skills.jsonl
      06_memory_brains.jsonl
      07_refusal_safety.jsonl
      08_boundaries.jsonl
      09_files_citations.jsonl
      10_formatting_length.jsonl
      11_error_degrade.jsonl
    structured_tasks/               worked Verity task exemplars (full traces)
      flow_decomposition.jsonl      conductor -> workers -> inspector -> converge
      office_state_cycle.jsonl      STATE.md checkpoint cycle
      confidence_rrr_trace.jsonl    Reason -> Rate -> Revise, scored
      wrap_injection_resistance.jsonl   untrusted-content injection trace
      prompt_optimizer_rewrite.jsonl    refiner v2: complexity + template + tone
      memory_extraction_decision.jsonl  learn_from_exchange store/skip decision
  scripts/
    build_dataset.py                assembles corpus -> dataset/verity_sft.jsonl
    validate.py                     messages-schema validator (standalone + imported)
  dataset/
    .gitignore                      the assembled jsonl is a build artifact (ignored)
    verity_sft.jsonl                GENERATED (not committed)
```

Every training line is chat/messages format:

```json
{"messages": [
  {"role": "system", "content": "..."},
  {"role": "user", "content": "..."},
  {"role": "assistant", "content": "..."}
]}
```

The `system` turn is optional in a **source** file. Role-scoped examples
(conductor/worker/inspector/office/flow, and the structured traces) carry their
own system message; plain behavioral examples omit it, and the build step renders
the core Verity system prompt into them (see below).

---

## How to build

```bash
# with the brain venv (recommended) or any Python 3.11+:
services/brain/.venv/bin/python model/scripts/build_dataset.py

# skip system-prompt injection (leaves rows exactly as authored):
services/brain/.venv/bin/python model/scripts/build_dataset.py --no-system
```

`build_dataset.py`:

1. reads every `corpus/behavioral/*.jsonl` and `corpus/structured_tasks/*.jsonl`;
2. renders `corpus/system_prompts/verity_9b_core.md` into a `system` turn for
   every row that lacks one (role-scoped rows keep their own);
3. validates every row against the messages schema (`validate.py`);
4. drops exact duplicates (same user+assistant content);
5. writes `dataset/verity_sft.jsonl` and prints a manifest (per-category counts,
   system-injection tally, dedupe result, schema result, size).

Validate any `.jsonl` on its own:

```bash
services/brain/.venv/bin/python model/scripts/validate.py model/corpus/behavioral/*.jsonl
```

Both scripts are **pure standard library** — no third-party dependencies.

### Current corpus size

- 11 behavioral categories · **155** examples
- 6 structured-task exemplar sets · **16** examples
- **171** total, 0 duplicates, 0 schema errors

---

## How to train (QLoRA, single 24 GB GPU)

The plan (§5); actual training runs behind the user gates (GPU + HF token):

1. **Provision.** Rent a 24 GB GPU (e.g. a single 3090/4090/A10). Install a
   QLoRA stack (transformers + peft + bitsandbytes + trl, or axolotl/unsloth).
2. **Authenticate.** `huggingface-cli login` with the operator's own HF token,
   then pull `empero-ai/Qwythos-9B-v2` from the official repo.
3. **Build the dataset.** Run `build_dataset.py` to produce
   `dataset/verity_sft.jsonl` in messages format.
4. **Fine-tune.** 4-bit NF4 base, LoRA adapters on the attention/MLP
   projections, packed sequences, a small number of epochs over this SFT mix.
   Keep the base frozen; only the adapters train.
5. **Merge / export.** Merge adapters (or keep them separate), then export to
   **GGUF** for Ollama serving on the Compute network.
6. **Verify behavior.** Spot-check against the structured-task exemplars: does it
   score confidence honestly, resist injected content, sanitize machinery at
   flow boundaries, and refuse in Verity's calm voice?

These sources are deliberately small and high-signal: this is a behavioral /
voice fine-tune on top of a capable base, not a from-scratch instruction tune.
Quality and correctness of every example matter more than volume — each one is
something we would be glad to have the model imitate.
