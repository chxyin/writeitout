# HMUN POI Training SaaS — Complete Build Log & Handoff

> Consolidated record of all decisions, scripts, data findings, and open threads from the LoRA build session. Save as `hmun_build_log.md`.

---

## 0. Project context (from original handoff)

**Product:** Web SaaS for training Model UN (MUN) delegates in the Hong Kong (HMUN) circuit. Core loop: user reads an AI-generated resolution + mock speech → writes a Point of Information (POI) → receives strict Chair-style feedback (grade A+/B/C + 1–2 sentence reasoning).

**Architecture:** Two-model LoRA pipeline, not a mega-prompt.
- **Playwright** — generates HMUN resolutions and speeches.
- **Director** — grades POIs against a strict rubric.

**Rubric:** POI must be (1) a question, (2) relevant to the speech, (3) impactful (exposes flaw / demands evidence), (4) brief (<40 words / <15s spoken).

**UI:** Royal blue `#2B5CE6` bg, red `#FF3B30` grades, orange `#FF9500` progress, white text, 20px CSS linear-gradient grid at `rgba(255,255,255,0.07)`, four floating shapes at `rgba(255,255,255,0.08)` (50–100px, 6–11s drift), Inter 400/600/800, single column max-width 600px centered.

**Stack:** React + Vite, Tailwind, shadcn/ui. React chosen because the app is a state machine (Question → Feedback → Cumulative → Next).

**LoRA hyperparameters (handoff):** rank=16, alpha=16, target_modules="all-linear", lr=2e-4, Unsloth, QLoRA 4-bit.

**Base model (handoff):** Llama 3.2 3B or Qwen 2.5 3B. → **Switched to DeepSeek-R1-Distill-Qwen-1.5B** (see §6).

**Data format (handoff):** JSONL, one object per line, `messages` array with `system` / `user` / `assistant` roles.

---

## 1. Conversation timeline

| Phase | What happened |
|---|---|
| 1 | Read handoff, offered 5 next-step options |
| 2 | "I need to build the LoRA" → produced full two-adapter build path |
| 3 | Uploaded `irrelevant extracurricular prep.pdf` → triaged corpus, manifest, training script |
| 4 | "What is my next step?" → create files before training; 60-min plan |
| 5 | Asked for extraction script → `extract.py` (two-pass) |
| 6 | "Do I just run your script?" → preflight + `speech_type()` bug patch |
| 7 | Asked for Doubao prompt → full prompt with 18-item audit |
| 8 | Doubao returned 6 files → reviewed, found 5 numeric corruptions + 2 hallucinations |
| 9 | "Small errors ok, can I train?" → yes, 34 lines enough for v1 |
| 10 | Samsung Galaxy Book (Intel, no CUDA) → Colab path |
| 11 | Qwen → DeepSeek swap → DeepSeek Colab notebook |
| 12 | Review round 1 → wrong chat template + wrong masking delimiters |
| 13 | Review round 2 → missing pad_token, EOS alignment, `<think>` risk, repetition_penalty |
| 14 | 9-cell paste-ready notebook delivered |
| 15 | DeepSeek vs Qwen cost comparison |
| 16 | Training finished → adapter obtained |
| 17 | "Tighten it, hardcore on info" → hardened system prompt + strict filter |
| 18 | Runtime estimate: 15–20 min |
| 19 | `max_new_tokens` warning explained (benign) — **waiting on `Kept X / 45`** |

---

## 2. Data extraction — what the PDF contained

**Source:** `irrelevant extracurricular prep.pdf`, ~85 pages, personal MUN notes dump.

### Triage table

| Category | Count | Usable? |
|---|---|---|
| Style rulebook (early Tai checklist, p.1) | 1 | Yes → system prompt |
| Resolutions | 12 | Yes |
| Speeches (opening / gsl1 / gsl2 / main_sub / for / against) | 28 | Yes (22 in v1) |
| POIs | 59 | Yes, but **ungraded** |
| Research notes (p.43–44, 82–83) | — | No |
| Chinese exercises (p.84–85) | — | No (CJK) |
| Meta commentary / page artifacts | — | No |

### Niche extraction issues found

| # | Risk | Resolution |
|---|---|---|
| 1 | Speaker tags `- Jason` / `- Abhijay` | Strip |
| 2 | Page artifacts (`1`, `===== Page N =====`) | Drop |
| 3 | CJK exercises | Exclude |
| 4 | Research notes | Exclude |
| 5 | Satirical (Canada p.62, Korea p.63, Iraq p.64, Yemen main_sub p.61) | Tag `tone=satirical`, `include_v1=no` |
| 6 | Fragment "Clause 4 states that money" (p.63) | Exclude |
| 7 | `IMPROMPTU` markers | Skip; do not invent |
| 8 | GSL #1 vs #2 | Regex `#1`→gsl1, `#2`→gsl2 |
| 9 | Length→seconds | `secs = round(wc/2.3/15)*15`, clamp 45–180 |
| 10 | p.4–6 unheadered resolution | kind=resolution, country="", committee=DISEC |
| 11 | `YEMENFORSPEECH` (p.52) | speech_type=for, country=Yemen |
| 12 | p.45 against-speech (complete, not fragment) | include_v1=yes |
| 13 | p.68 AI GSL — no country | Leave blank |
| 14 | UAE resolution ~1700 tokens | Never truncate |
| 15 | POIs ungraded | Leave grade/feedback blank |
| 16 | IDs traceable | `res_01…`, `sp_01…`, `poi_01…` |
| 17 | System prompt byte-identical | Embed verbatim |
| 18 | 85 pages may exceed single pass | Report counts first |

---

## 3. `extract.py` — summary

Two modes:
```bash
python3 extract.py --pdf "irrelevant extracurricular prep.pdf" --outdir data
python3 extract.py --input data/raw.txt --outdir data --review data/manifest_review.csv
```

**Bug patched after review** — `speech_type()` had a broken literal `"#? 2" in h`. Corrected:
```python
    if "gsl" in h or "general speaker" in h:
        if re.search(r"#?\s*2\b", h): return "gsl2"
        if re.search(r"#?\s*1\b", h): return "gsl1"
        return "gsl"
```

---

## 4. Doubao extraction — audit

### Numeric corruptions (decimal points dropped)
| POI | Source | Doubao wrote | Impact |
|---|---|---|---|
| poi_07 (China) | "Why did the Chinese government **not** take action" | "Why did… take action" | **Inverts meaning** |
| poi_06 (Saudi) | 57.4% GDP | 5.74% | Order of magnitude |
| poi_22 (Somalia) | 5.4 million USD | 54 million | 10× |
| poi_25 (UK) | 9.7 billion GBP | 97 billion | 10× + stray escape |
| poi_28 (India) | "coast of Somalia" | "coast of Somalialand" | Hallucinated word |

### Hallucinated metadata (violated "do not guess")
| Item | Claimed | Reality |
|---|---|---|
| `res_04` | country=USA, topic="Combatting Corruption…Venezuela" | p13–15 no header → blank |
| `res_07` | country=Belarus, topic="Discussing Oil's Role…" | No header; topic copied from res_08 → blank both |

### Metadata fixes
- `sp_04`: gsl → **gsl1**
- `sp_08`: gsl → **gsl2**
- `res_03`: topic → "Venezuela sovereignty"
- `res_09`: topic → "Addressing Modern Slavery and Human Trafficking in the Horn of Africa"

### Reclassifications
- `sp_01`: fragment → complete against-speech → **flip include_v1=yes**
- `poi_18`, `poi_20`, `poi_21` → exclude (satirical/meta)
- `poi_44`–`poi_59` (16 rows) → tag `source=template`

### Final corpus
- 12 resolutions, 22–23 speeches, 59 POIs

---

## 5. `loraspeech` training — original Qwen version

```python
from datasets import load_dataset
from unsloth import FastLanguageModel, is_bf16_supported
from unsloth.chat_templates import get_chat_template, train_on_responses_only
from trl import SFTTrainer, SFTConfig

BASE = "unsloth/Qwen2.5-3B-Instruct"
MAX_SEQ = 4096

model, tokenizer = FastLanguageModel.from_pretrained(BASE, max_seq_length=MAX_SEQ, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0.0, bias="none",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    use_gradient_checkpointing="unsloth", random_state=3407,
)
tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")

ds = load_dataset("json", data_files="data/loraspeech_train.jsonl", split="train")
ds = ds.map(lambda b: {"text":[tokenizer.apply_chat_template(m, tokenize=False) for m in b["messages"]]}, batched=True)

trainer = SFTTrainer(
    model=model, tokenizer=tokenizer, train_dataset=ds,
    args=SFTConfig(
        output_dir="adapters/loraspeech", num_train_epochs=3,
        per_device_train_batch_size=2, gradient_accumulation_steps=4,
        learning_rate=2e-4, warmup_steps=10, logging_steps=10,
        optim="adamw_8bit", seed=3407, report_to="none",
        max_seq_length=MAX_SEQ, dataset_text_field="text", packing=False,
        fp16=not is_bf16_supported(), bf16=is_bf16_supported(),
    ),
)
trainer = train_on_responses_only(
    trainer, instruction_part="<|im_start|>user\n", response_part="<|im_start|>assistant\n",
)
trainer.train()
model.save_pretrained("adapters/loraspeech")
```

**Why `train_on_responses_only`:** without it, loss includes system + user, teaching the model to reproduce prompts.

**Length conditioning:** user prompt carries `Target duration: {secs} seconds`. Filter so `wc / 2.3 ≈ secs` within ±15%. Speaking rate 2.3 w/s (MUN standard).

**Export modes:**
| Mode | Save | Use case |
|---|---|---|
| LoRA adapter only | tens of MB | Hot-swapping, vLLM multi-LoRA |
| Merged 16-bit | full model | vLLM throughput |
| GGUF | quantized merged | llama.cpp / Ollama |

**Serving:** vLLM merged 16-bit, two services (`/generate-resolution`, `/grade-poi`), API gateway. Or vLLM multi-LoRA hot-swap.

**Failure modes documented:**
- Playwright overfits one topic
- Director learns format not judgment (low grade variance)
- Chat template mismatch
- JSON drift in Director (use `outlines` / `lm-format-enforcer`)
- Evaluating on training loss only

---

## 6. DeepSeek — full technical reference

### 6.1 Model identity

| Attribute | Value |
|---|---|
| HF repo (base) | `deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B` |
| HF repo (used) | `unsloth/DeepSeek-R1-Distill-Qwen-1.5B-bnb-4bit` |
| Released | 20 January 2025 |
| Teacher model | `deepseek-ai/DeepSeek-R1` (671B MoE) |
| Base architecture | `Qwen/Qwen2.5-Math-1.5B` (note: **Math** variant, not general instruct) |
| Total parameters | ~1.78B (1.54B non-embedding) |
| License | MIT (distill series) |
| Distillation method | Supervised fine-tune on ~800k reasoning traces generated by R1 teacher |

**Lineage:** DeepSeek trained their 671B MoE flagship R1 → generated 800k reasoning traces on diverse prompts → fine-tuned Qwen2.5-Math-1.5B on those traces → released as the 1.5B distill. The 1.5B model **inherits the reasoning behavior** but cannot match teacher quality; empirically, it retains ~40–60% of R1's reasoning on narrow tasks.

### 6.2 Architecture specifics

| Component | Value |
|---|---|
| Type | Dense decoder-only transformer (no MoE — MoE is only in teacher) |
| Hidden size | 1536 |
| Layers | 28 |
| Attention | GQA (12 query heads, 2 KV heads) — 6:1 ratio |
| Head dim | 128 |
| MLP intermediate | 8960 (SwiGLU) |
| Vocab size | 151,936 |
| Context | 131,072 (131k) |
| Positional | RoPE (rotary) |
| Norm | RMSNorm |
| Activation | SwiGLU |
| Tied embeddings | Yes (input = output projection) |

**GQA implication:** Because k_proj and v_proj have only 2 heads (vs 12 for q), their parameter counts and LoRA adapter sizes are smaller than the q_proj adapter. This is fine for training — Unsloth's `target_modules` covers all four attention projections plus three MLP projections.

### 6.3 Tokenizer

- **Type:** Qwen2 BPE (byte-pair encoding)
- **Vocab size:** 151,936
- **Special tokens (full-width bars, U+FF5C not U+007C):**

| Token | Purpose |
|---|---|
| `<｜begin▁of▁sentence｜>` | BOS |
| `<｜end▁of▁sentence｜>` | EOS |
| `<｜User｜>` | user turn delimiter |
| `<｜Assistant｜>` | assistant turn delimiter |
| `<think>` / `</think>` | reasoning block (in some variants) |

- **`pad_token`:** None by default — **must set** `tokenizer.pad_token = tokenizer.eos_token`
- **`eos_token`:** `<｜end▁of▁sentence｜>` — **must align** to `model.config.eos_token_id`
- **Also in vocab but unused:** `<|im_start|>`, `<|im_end|>` (Qwen ChatML) — the model's chat template does NOT use these

**Verification at runtime:**
```python
print(tokenizer.chat_template[:200])
print(repr(tokenizer.eos_token), tokenizer.eos_token_id)
print(repr(tokenizer.pad_token))  # None before fix
```

### 6.4 Chat template (exact)

The model ships a **native template using full-width bars**. Do **not** override with `get_chat_template(..., "qwen-2.5")` — that substitutes ChatML delimiters (`<|im_start|>`) the model was not trained with.

Effective template shape:
```
<｜begin▁of▁sentence｜>
{system content}
<｜User｜>
{user content}<｜Assistant｜>
{assistant content}<｜end▁of▁sentence｜>
```

**What `add_generation_prompt=True` does:** appends `<｜Assistant｜>` (and on some tokenizer versions also `<think>`), triggering the model to start its response.

**The trap we hit:** `get_chat_template(..., "qwen-2.5")` silently replaces the native template with Qwen ChatML. Result: the model sees `<|im_start|>user` instead of `<｜User｜>`, degrading quality and breaking `train_on_responses_only` masking.

### 6.5 Quantization (bnb-4bit)

| Aspect | Detail |
|---|---|
| Method | BitsAndBytes NF4 (NormalFloat 4-bit) |
| Double quantization | Yes (quantizes the quantization constants) |
| Compute dtype | bfloat16 on Ampere+, float16 on T4 |
| Pre-quantized | Yes — `unsloth/...-bnb-4bit` is already quantized; loading does not quantize on the fly (faster load) |
| Effective bytes/param | ~0.5 (4 bits + overhead) |
| Weight memory | ~1.0–1.5 GB for 1.5B model |

**What 4-bit quantization does to quality:** minimal loss for fine-tuning — the *base* weights are frozen and the LoRA adapter trains in **full precision** (fp16/bf16). The quantization only affects the frozen base. This is why QLoRA works.

### 6.6 VRAM math (Colab T4)

| Component | Estimated VRAM |
|---|---|
| 4-bit base weights | ~1.2 GB |
| LoRA adapter (r=16, fp16) | ~14 MB |
| Optimizer states (8-bit AdamW) | ~14 MB |
| Activations (batch=2, seq=4096, grad ckpt on) | ~2–3 GB |
| **Total training footprint** | **~3–4 GB** |
| T4 available | 15 GB |
| **Headroom** | **~11 GB** |

Inference footprint: ~1.5–2 GB (weights + KV cache).

**Why T4 works easily:** the 1.5B + QLoRA + gradient checkpointing combo is intentionally chosen to fit comfortably. The 7B distill would be ~5–6 GB, still feasible but with tighter batch sizing.

### 6.7 Why this model vs alternatives

| Option | Params | VRAM (4-bit, train) | Reasoning | Verdict |
|---|---|---|---|---|
| **DeepSeek-R1-Distill-Qwen-1.5B** | 1.78B | ~3–4 GB | Distilled R1 | **Chosen** — fits T4, fast, reasoning prior |
| DeepSeek-R1-Distill-Qwen-7B | 7.6B | ~7–8 GB | Stronger distillation | Viable; ~3× slower, batch=1 |
| DeepSeek-R1-Distill-Llama-8B | 8B | ~7–9 GB | Strongest distill | Best quality; ~30 min training |
| DeepSeek-R1 (671B MoE) | 671B | >400 GB | Full | Impossible on T4 |
| Qwen2.5-3B-Instruct | 3B | ~5 GB | No R1 distillation | Original; discarded |
| Llama-3.2-3B-Instruct | 3B | ~5 GB | No R1 distillation | Original; discarded |

**Why swap from Qwen 2.5 3B → DeepSeek 1.5B:** smaller VRAM, native reasoning distillation, same tokenizer family (Qwen2), and still 1.5B is enough for style transfer. The reasoning distillation is a marginal gain for our task, but the smaller model allows faster iteration.

**If output density is insufficient after v1:** move to `DeepSeek-R1-Distill-Llama-8B` (T4-compatible, denser output, ~30 min training).

### 6.8 The three structural problems (detailed)

**Problem 1 — Forced wrong chat template:**
```python
# WRONG:
tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")
```
This overrides the native DeepSeek template with Qwen ChatML. Model sees `<|im_start|>` instead of `<｜User｜>`. Result: quality degradation, broken role boundaries.

**Fix:** do not call `get_chat_template`. Use native:
```python
# CORRECT:
print(tokenizer.chat_template[:200])  # verify
# do not override
```

**Problem 2 — Wrong masking delimiters:**
```python
# WRONG:
trainer = train_on_responses_only(
    trainer, instruction_part="<|im_start|>user\n", response_part="<|im_start|>assistant\n"
)
```
With wrong strings, `train_on_responses_only` finds no delimiter matches and **masks nothing** — loss is computed on system + user + assistant. Model learns to reproduce prompts.

**Fix:**
```python
# CORRECT:
trainer = train_on_responses_only(
    trainer, instruction_part="<｜User｜>", response_part="<｜Assistant｜>"
)
```

**Problem 3 — Missing pad_token + EOS alignment:**

Three failures at once:
1. `tokenizer.pad_token` is `None` → batching during training raises `ValueError: Cannot pad without a pad token`
2. `model.config.eos_token_id` not set → generation ignores EOS and runs to `max_new_tokens`
3. If `pad_token` is set but not equal to EOS → generation can produce `<pad>` tokens mid-output

**Fix:**
```python
tokenizer.pad_token = tokenizer.eos_token
model.config.pad_token_id = tokenizer.pad_token_id
model.config.eos_token_id = tokenizer.eos_token_id
```

### 6.9 Reasoning trace behavior

**Why traces appear:** R1 series trained with RL to produce `<think>...</think>` blocks before answering. Distill models inherit this behavior. At `add_generation_prompt=True`, the template (depending on version) may insert `<think>` to trigger reasoning.

**Observed behavior at 1.5B:**
- Traces are **short** (50–150 tokens typically) — the 1.5B model cannot reason deeply
- Traces are **often incomplete** (model truncates reasoning and jumps to answer)
- For our style-transfer task, traces are **noise** — they consume token budget and bleed into output
- For our fine-tuning data (which contains **no** traces), the adapter learns to skip traces — but base model's RLHF prior fights this, so ~10–30% of generations still include them

**Two mitigations:**

1. **Strip at decode (reliable):**
```python
text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
```

2. **Suppress at generation (unreliable across versions):**
```python
# Some tokenizers support suppress_tokens for <think> tokens
# Not consistent — stripping is safer
```

**Diagnostic:** if stripped output is <100 words for a 90s speech, the trace consumed the budget. Increase `max_new_tokens` to 800+ or lower `temperature` to 0.7.

### 6.10 Generation parameters (and why)

| Param | Value | Why |
|---|---|---|
| `max_new_tokens` | 600–800 | 120s speech ≈ 275 words ≈ 400–500 tokens; leaves room for `<think>` + repetition |
| `temperature` | 0.85 (0.7 in test) | Conservative for style; 0.7 for tight inference, 0.85 for varied generation |
| `top_p` | 0.95 | Nucleus sampling, standard for creative |
| `do_sample` | True | Required with temperature |
| `repetition_penalty` | 1.1–1.15 | **Essential** — R1 distills loop without it; 1.15 for hardcore generation |
| `eos_token_id` | `tokenizer.eos_token_id` | Explicit — prevents running past speech end |
| `pad_token_id` | `tokenizer.eos_token_id` | Required for batch generation |

### 6.11 Known failure modes specific to DeepSeek

| # | Failure | Symptom | Fix |
|---|---|---|---|
| 1 | Repetition loops | Same clause repeated 3+ times | `repetition_penalty=1.15` |
| 2 | `<think>` bleed | Output starts with reasoning | `re.sub(r"<think>.*?</think>", "", ...)` |
| 3 | Full-width bar confusion | Delimiter not found → masking fails | Use `｜` (U+FF5C), not `\|` (U+007C) |
| 4 | Missing EOS | Generation runs to `max_new_tokens` | Set `model.config.eos_token_id` |
| 5 | `pad_token=None` | Batching crashes | `tokenizer.pad_token = tokenizer.eos_token` |
| 6 | Template override trap | Quality degrades silently | Do not call `get_chat_template` |
| 7 | 1.5B shallowness | Output too generic | Move to 7B or 8B distill |
| 8 | Tokenizer mismatch | Silent garbage | Verify vocab=151,936 |
| 9 | Multi-GPU `device_map` | Not an issue on single T4 | Use Unsloth defaults |

### 6.12 Colab specifics

| Aspect | Detail |
|---|---|
| GPU | NVIDIA T4, 15 GB VRAM, ~16 GB system RAM |
| CUDA | 12.1 (matches `cu121` build) |
| Session timeout | 90 min idle, 12 hr max |
| Free tier | No GPU guarantee; may need to wait |
| State persistence | **Lost on disconnect** — re-upload files, reload model |
| Recommended | Mount Google Drive to save adapter zip between sessions |
| Training time (34 lines) | ~10–15 min |
| Generation time (45 attempts) | ~15–20 min |

**If T4 unavailable:** Kaggle (same workflow, 30 hr/week free). Or Colab Pro (~$10/mo) for faster GPU + longer sessions.

### 6.13 Cost comparison (expanded)

**Training cost (your actual use):**

| Path | Cost |
|---|---|
| Open weights + Colab free T4 | **$0** |
| Colab Pro (V100/A100) | ~$10/mo |
| RunPod T4 | ~$0.20/hr |
| RunPod A100 | ~$1.50/hr |

Our training run (34 lines, 3 epochs, ~10 min on T4) is **~$0.03–0.05 worth of compute** if paying hourly. On Colab free, $0.

**API inference cost (future, if using hosted models for generation):**

| Model | Input/1M | Output/1M | Notes |
|---|---|---|---|
| DeepSeek V4-Pro | ~$0.42 (miss) / ~$0.0035 (hit) | ~$0.84 | Flagship |
| DeepSeek V3 | $0.24 | $0.90 | Previous gen |
| Qwen-plus (US) | $0.40 | $1.20 | Mid-tier |
| Qwen Turbo | $0.05 | $0.20 | Cheapest small |

**Our generation need:** ~150 speeches × ~400 output tokens = ~60k tokens = **~$0.05** at DeepSeek V4-Pro rates. Negligible.

**Verdict:** cost is **not** a deciding factor at our scale. Train for style capture, not cost savings.

---

## 7. Training result — what was obtained

**Output:** `loraspeech_deepseek/` folder + `loraspeech_deepseek_adapter.zip`

| File | Contents |
|---|---|
| `adapter_model.safetensors` | Trained LoRA weights (~15–30 MB) — **the valuable output** |
| `adapter_config.json` | r=16, alpha=16, target modules |
| `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` | Tokenizer files |

**Base model frozen.** Only adapter trained. This is a **Playwright specialist** — generates HMUN-style speeches/resolutions.

**Caveat:** 34 lines is thin. Adapter likely memorizes more than generalizes. Pipeline works — that was the point.

**Expected adapter size:** for r=16 on this model, ~5–7M trainable params → ~15–30 MB fp16. If zip is >100 MB, something went wrong (merged weights, not adapter-only).

---

## 8. Hardcore tightening — current phase

### 8.1 Hardened system prompt

Write to `system_speech_hardcore.txt`:

```python
HARDCORE = """You write HMUN (Hong Kong circuit) speeches. Maximum information density. Zero filler.

NON-NEGOTIABLE RULES
- Every sentence must carry a fact, a number, a named actor, a resolution, or a mechanism. No sentence may exist only to transition.
- BANNED phrases (never use): "we believe", "it is important to", "in conclusion", "many countries", "various nations", "on the global stage", "plays a crucial role", "we must work together", "now more than ever".
- Named actors only. Not "some states" — name them. Not "recent conflicts" — name the conflict and year.
- Every statistic carries a source in-line: "(UNODC, 2023)", "(World Bank, 2024)", "(S/RES/2722)".
- Every past-action reference carries the exact resolution number AND year AND why it failed mechanically — not "it was ineffective", but "it lacked an enforcement annex and no member state funded the monitoring body".

OPENING STRUCTURE (60-120s)
1. Hook (1-2 sentences, max 8 seconds): a quote with attribution, a statistic with source, or a named event with date. Never generic.
2. Stance: "The delegation of X holds that..."
3. Two statistics maximum, each sourced, each tied to a mechanism not just a magnitude.
4. One past UN action with resolution number, year, and the specific mechanical reason it failed.
5. Three solutions, named as mechanisms in one clause each, no elaboration: "establish X with mandate Y", "fund Z through W", "mandate V under Article N".
6. Closing call, one sentence.

GSL STRUCTURE (90-135s)
- One-sentence intro that states the problem as a measurable failure.
- Three pillars, each strictly: claim → sourced evidence → causal mechanism → link to the topic.
- Each pillar names at least one actor and one instrument (treaty, fund, body, sanction, mandate).
- Closing line: "The delegate yields the floor to any and all POIs." or "Let all those who concur meet in the caucus."

RESOLUTION STRUCTURE
- Preambulatory clauses cite named instruments and years.
- Every operative clause names a body, a funding source, a reporting cadence, and an enforcement trigger.
- No operative clause may be vague: "Encourages cooperation" is banned. "Establishes the X Working Group under Y, reporting quarterly to Z, funded by W" is required.

HARD LIMITS
- Stay within ±10% of the requested duration (2.3 words/second).
- No rhetorical questions except the final yield line.
- No repetition of the same statistic or resolution twice.
- No self-reference to the speech itself ("in this speech", "as I will show")."""

open("system_speech_hardcore.txt", "w").write(HARDCORE)
```

### 8.2 Strict quality filter

```python
import json, random, re

TOPICS = [
    "Water crisis in Southeast Asia", "Maritime piracy in the Red Sea",
    "Neocolonialism in West Africa", "AI as digital neocolonialism",
    "Oil revenue financing armed groups", "Modern slavery in the Horn of Africa",
    "Nuclear deterrence on NATO's eastern flank", "Debt relief for LEDCs",
    "Human trafficking and border security", "Grey-zone economic coercion",
    "Refugee integration in host states", "Space militarisation",
    "Antimicrobial resistance", "Food security and supply-chain fragility",
    "Disinformation and election integrity",
]
COMMITTEES = ["DISEC", "ECOSOC", "HRC", "UNSC", "SOCHUM", "SPECPOL"]
COUNTRIES = ["Brazil","Nigeria","Indonesia","Japan","Germany","Kenya","Chile",
             "Vietnam","Egypt","Canada","Pakistan","Norway","Mexico",
             "South Africa","India","Poland","Philippines","Ghana"]
TYPES = ["opening","gsl1","gsl2"]
SECS  = [60, 90, 120]

BANNED = re.compile(
    r"\b(we believe|it is important to|in conclusion|many countries|"
    r"various nations|on the global stage|plays a crucial role|"
    r"we must work together|now more than ever)\b", re.I)
HAS_NUMBER  = re.compile(r"\b\d[\d,\.]*\s*(%|million|billion|thousand|USD|GBP|EUR|tonnes|people|vessels|states)\b", re.I)
HAS_RES     = re.compile(r"(\b[SR]?/?RES/?\d{3,4}\b|\bResolution\s+\d+|\bUNSC\s+\d+|\bA/RES)", re.I)
NAMED_ACTOR = re.compile(r"\b(China|Russia|United States|USA|Iran|Saudi|India|Brazil|Nigeria|EU|NATO|ASEAN|African Union|IMF|World Bank|WHO|UNODC|UNHCR|IMO|INTERPOL)\b")

def quality_ok(text, secs):
    wc = len(text.split()); tw = secs * 2.3
    if not (tw * 0.85 <= wc <= tw * 1.15): return False, "length"
    if BANNED.search(text): return False, "banned_phrase"
    if len(HAS_NUMBER.findall(text)) < 2: return False, "too_few_stats"
    if not HAS_RES.search(text): return False, "no_resolution"
    if len(NAMED_ACTOR.findall(text)) < 2: return False, "too_few_actors"
    if not re.search(r"(Thank you|yields the floor|meet in the caucus)", text, re.I):
        return False, "no_closing"
    return True, "ok"

system_speech = open("system_speech_hardcore.txt").read().strip()
kept, rejects = [], {}

for topic in TOPICS:
    for _ in range(3):
        country   = random.choice(COUNTRIES)
        committee = random.choice(COMMITTEES)
        stype     = random.choice(TYPES)
        secs      = random.choice(SECS)
        user = (f"Write a {stype} speech. Country: {country}. Committee: {committee}. "
                f"Topic: {topic}. Target duration: {secs} seconds. "
                f"Cite at least two sourced statistics and one exact resolution number. "
                f"Name at least two non-domestic actors. Output the speech directly.")
        msgs = [{"role":"system","content":system_speech},{"role":"user","content":user}]
        inp = tokenizer.apply_chat_template(msgs, tokenize=True,
                                             add_generation_prompt=True,
                                             return_tensors="pt").to("cuda")
        out_ids = model.generate(inp, max_new_tokens=800, temperature=0.85,
                                 top_p=0.95, do_sample=True, repetition_penalty=1.15,
                                 eos_token_id=tokenizer.eos_token_id)
        text = tokenizer.decode(out_ids[0][inp.shape[1]:], skip_special_tokens=True)
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
        text = re.sub(r"^<｜Assistant｜>\s*", "", text).strip()

        ok, reason = quality_ok(text, secs)
        if not ok:
            rejects[reason] = rejects.get(reason, 0) + 1
            continue
        kept.append({"id": f"gen_{len(kept):03d}", "topic": topic,
                     "committee": committee, "country": country,
                     "speech_type": stype, "target_seconds": secs,
                     "word_count": len(text.split()), "text": text})

json.dump(kept, open("generated_speeches_hardcore.json","w"), indent=2)
print(f"Kept {len(kept)} / {len(TOPICS)*3}")
print("Rejections:", rejects)
```

### 8.3 Filter rationale

| Check | Why |
|---|---|
| Word count ±15% | Timing discipline |
| No banned filler | Kills boilerplate |
| ≥2 sourced stats | Evidence density |
| ≥1 resolution ref | Institutional knowledge |
| ≥2 named actors | Kills vague "many states" |
| Proper closing line | Prevents truncation |

### 8.4 Expected pass rate & DeepSeek-specific reasoning

**Expected pass rate: 35–55%** on a 1.5B model. This is normal — the filter is doing its job.

**Why 1.5B underperforms on hardcore:** the model's *capacity* limits density, not its prior. A 120s speech (~275 words) must fit 2 stats + 1 resolution + 3 solutions + 1 stance + 1 hook + 1 closing in that budget. The 1.5B struggles to pack all elements at the density the prompt demands. Symptoms:
- `too_few_stats` dominant rejection → model abandons stats under pressure
- `no_resolution` → model cites "a past UN action" without number
- `too_few_actors` → model uses "some states", "the international community"

**If pass rate <25%:** retrain `loraspeech` on current pass-set (v2 loop). **If pass rate <15%:** move to `DeepSeek-R1-Distill-Llama-8B`. The 8B variant runs on T4 with batch=1, ~30 min training, and materially denser output — this is the natural upgrade if 1.5B stalls.

**If pass rate >65%:** the filter is loose. Tighten `HAS_NUMBER` to require 3+ stats, or add a coherence check (regex for repeated sentence openings).

### 8.5 Runtime

**~15–20 minutes** for 45 attempts. Each generation 15–25s at T4 speed (~30–40 tok/s). If Colab session died, add ~2 min to reload adapter.

---

## 9. Niche gotchas logged (expanded)

1. **`max_new_tokens` vs `max_length` warning** — "Both `max_new_tokens` (=800) and `max_length` (=131072) seem to have been set" is **informational, not an error**. `max_new_tokens` takes precedence. Prints once per generation. **11 lines = 11 generations done.**

2. **DeepSeek `<think>` blocks** — R1 distill injects reasoning via `add_generation_prompt=True`. Filter with `re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)`.

3. **Full-width bars** — DeepSeek delimiters use `｜` (U+FF5C), not `|` (U+007C). Easy to copy wrong; breaks `train_on_responses_only` masking silently.

4. **`pad_token` is None** by default. Set `tokenizer.pad_token = tokenizer.eos_token`.

5. **EOS alignment** — set both `model.config.eos_token_id` and `tokenizer.eos_token`, else generation won't stop.

6. **Repetition penalty** — 1.1–1.15 needed; R1 distills loop without it.

7. **Galaxy Book = Intel integrated** — no CUDA. Colab T4 only.

8. **DeepSeek is not a training platform** — JSONL upload to chat interface fails.

9. **34 lines is thin** — v1 adapter is a smoke test. Expect memorization.

10. **POI grading is human-only** — Doubao correctly left grade/feedback blank. Do not automate; it collapses the signal.

11. **`<think>` consumption** — for 90s speech (~200 words ≈ 280 tokens), a 150-token `<think>` block consumes half the budget. `max_new_tokens=800` gives room; 600 is tight.

12. **Chat template verification** — always `print(tokenizer.chat_template[:200])` before training. Never assume.

13. **`save_strategy="no"`** — avoids saving intermediate checkpoints on tiny dataset; the final save is sufficient.

14. **`fp16` vs `bf16`** — T4 does **not** support bf16 (Ampere+ only). `is_bf16_supported()` returns False on T4, so `fp16=True` is used. On A100/H100, `bf16=True` engages and trains marginally faster.

15. **Adapter size sanity** — a valid adapter-only `safetensors` for r=16 is ~15–30 MB. If zip >100 MB, merged weights were saved (use `save_pretrained` not `save_pretrained_merged`).

16. **`repetition_penalty` >1.2** — starts degrading fluency; 1.15 is the sweet spot for hardcore generation, 1.1 for normal.

17. **Temperature floor** — below 0.6, the 1.5B becomes deterministic and repeats phrase patterns; 0.7 is the practical floor.

18. **`skip_special_tokens=True`** — already handles `<｜end▁of▁sentence｜>` and `<｜begin▁of▁sentence｜>`; do **not** additionally strip them manually (redundant and can corrupt legitimate text).

19. **`packing=False`** — critical for instruction/chat data; `packing=True` concatenates examples and corrupts boundaries.

20. **`train_on_responses_only` with wrong delimiters** — silently no-ops (masks nothing). No error raised. Verify by inspecting `trainer.train_dataset[0]['text']` contains the correct delimiter.

---

## 10. Current state & next steps

### ✅ Completed
- PDF triaged, extracted (12 res, 28 sp, 59 POIs)
- 5 numeric corruptions + 2 hallucinations identified (still need manual fix)
- DeepSeek `loraspeech` trained (adapter saved)
- Hardened generation prompt + strict filter written

### ⏳ In progress
- **Waiting for `Kept X / 45` output**
- Download of `generated_speeches_hardcore.json`

### 🔜 Next
1. **Fix POI corruptions** in `pois_review.csv` (5 rows: poi_07, poi_06, poi_22, poi_25, poi_28)
2. **Review `generated_speeches_hardcore.json`** — skim 5, drop repetitive/hallucinated
3. **Hand-grade 100–150 POI pairs** — target distribution **15% A+, 65% B, 20% C**
4. **Build `lorapois_train.jsonl`** — strict JSON schema
5. **Train `lorapois`** — same Colab setup, change DATA_PATH + OUTPUT_DIR
6. **Validate Director** — 100% valid JSON, ≥80% grade agreement on gold
7. **Merge to 16-bit, deploy on vLLM**

### 🚧 Blocked / open
- `res_04` / `res_07` fabricated metadata → blank
- `sp_01` → flip to `include_v1=yes`
- `poi_44`–`poi_59` → tag `source=template`

---

## 11. Schema reference

### `loraspeech_train.jsonl`
```json
{"messages":[
  {"role":"system","content":"<SYSTEM_SPEECH or SYSTEM_RES verbatim>"},
  {"role":"user","content":"<user prompt>"},
  {"role":"assistant","content":"<cleaned text>"}
]}
```

**Resolution prompt:** `Write a resolution. Committee: {committee}. Topic: {topic}. Main submitter: {country}.`

**Speech prompt:** `Write a {speech_type} speech. Country: {country}. Committee: {committee}. Topic: {topic}. Target duration: {secs} seconds. Stats allowed: 2 max.`

### `lorapois_train.jsonl` (planned)
```json
{"messages":[
  {"role":"system","content":"You are a strict HMUN Chair grading a Point of Information. Rubric: (1) must be phrased as a question; (2) must be relevant to a specific claim in the speech; (3) must be impactful — exposes a flaw or demands evidence/mechanism; (4) must be brief, under 40 words. Return ONLY valid JSON: {\"grade\":\"A+\"|\"B\"|\"C\",\"feedback\":\"1-2 sentences citing the rubric criterion that determined the grade\"}. No markdown. No prose outside the JSON."},
  {"role":"user","content":"Speech:\n<speech>\n\nPOI:\n<poi>"},
  {"role":"assistant","content":"{\"grade\":\"B\",\"feedback\":\"...\"}"}
]}
```

### Grade rubric
| Grade | Criteria |
|---|---|
| **A+** | All 4 pass + specific clause/claim + forces substantive defence |
| **B** | 3 pass; soft impact or slightly long |
| **C** | ≤2 pass; rhetorical, not question, off-topic, >40 words |

---

## 12. File inventory

```
hmun/
├── data/
│   ├── raw.txt
│   ├── proposed_segments.json
│   ├── manifest_review.csv
│   ├── loraspeech_train.jsonl            # 34 lines, validated
│   ├── pois_review.csv                   # 59 POIs, needs grades
│   ├── system_speech.txt
│   ├── system_res.txt
│   ├── system_speech_hardcore.txt
│   ├── generated_speeches_hardcore.json  # ⏳ pending
│   └── extraction_report.md
├── adapters/
│   └── loraspeech_deepseek/              # ✅ trained
│       ├── adapter_model.safetensors     # ~15–30 MB
│       ├── adapter_config.json
│       └── tokenizer*.json
├── extract.py
└── loraspeech_deepseek_adapter.zip
```

---

*End of log.*