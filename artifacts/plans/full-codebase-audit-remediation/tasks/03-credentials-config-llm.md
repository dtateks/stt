# Task 03: Harden credentials, config, shell fallback, and LLM adapters

- **Agent**: golem
- **Skills**: arch-best-practices
- **Wave**: 1
- **Complexity**: M

## Owns
- `src/src/credentials.rs` (modify)
- `src/src/shell_credentials.rs` (modify)
- `src/src/llm_service.rs` (modify)
- `config.json` (modify)
- `src/tests/native_services.rs` (modify)

## Entry References
- `src/src/credentials.rs:28` — precedence resolution entrypoint
- `src/src/credentials.rs:66` — persisted credential save/reset flows
- `src/src/shell_credentials.rs:13` — shell environment cache/fallback path
- `src/src/llm_service.rs:18` — xAI adapter and response parsing
- `config.json:1` — bundled runtime config contract consumed by `get_config`

## Exemplar
- `src/tests/native_services.rs` — existing pure service regression tests for precedence, shell parsing, and LLM parsing are the pattern to extend

## Produces
- `C-03-config-service-contract`:
  - Signature: `get_credentials(app) -> Result<Credentials, String>`, `resolve_credentials_with_precedence(store, env, shell) -> Credentials`, `correct_transcript(transcript, apiKey, llmConfig, outputLang) -> Result<String, String>`, `AppConfig = { soniox, llm, voice }`
  - Behavior: credential precedence is explicit and testable; corrupt store/config states are handled intentionally rather than silently; xAI adapter errors are actionable and do not leak secrets; bundled config stays aligned with code expectations.
  - Validate: `cargo test --manifest-path src/Cargo.toml` passes with expanded native service coverage.

## Consumes
- `None`

## Tests
- **Skip reason**: None

## Steps
1. Audit the credential store, env fallback, shell fallback, bundled config shape, and xAI adapter for SRP violations, silent fallback behavior, secret-handling risk, and error-taxonomy gaps.
2. Refactor owned files so precedence, parse failures, and remote error handling are explicit and intentional; keep the store → env → shell order unless a concrete defect proves it should change.
3. Align `config.json` with the code’s real expectations if the audit shows drift, and keep the contract narrow and self-validating instead of relying on loose JSON assumptions.
4. Expand `src/tests/native_services.rs` to cover corrupt inputs, fallback boundaries, response-shape edge cases, and any newly explicit config or error behavior.

## Failure Modes
- **If a fix would expose a shared bridge/type change**: report the required serialized shape for Task 07 instead of editing `ui/src/types.ts` or `ui/tauri-bridge.js` here.
- **If shell fallback behavior is ambiguous or security-sensitive**: preserve evidence with tests and explicit errors; never log secrets or widen the fallback surface casually.
- **If an upstream API behavior cannot be integration-tested locally**: lock parser/result behavior with deterministic tests and flag live verification for Task 08.

## Guardrails
- Do not log secrets, persist secrets in new locations, or widen credential search paths without clear justification.
- Do not keep silent parse fallback behavior unless it remains intentional, documented in tests, and justified by the shipped UX.
- Do not add new dependencies unless existing ones demonstrably cannot satisfy the fix.

## Acceptance
- `cargo test --manifest-path src/Cargo.toml`

## Report (include in your final response to orchestrator)
- **Actual outputs**: files created/modified with paths
- **Test evidence**: exact test command(s) executed + PASS/FAIL summary + scope (or skip reason from Tests section)
- **Resolved review items**: for each fixed `CRIT-*`/`IMP-*` issue from Heimdall, provide `ID → changed files → verification command/result` (or `None`)
- **Contract amendments**: if Produces signatures changed from planned → actual signature + reason + classification (bug-fix or plan-correction) (or `None`)
- **New constraints or prerequisites**: newly discovered downstream-affecting constraints/prereqs, or `None`
- **Deviations**: other differences from planned behavior (or `None`)
- **Discoveries**: patterns found, gotchas, unexpected behavior affecting other tasks — include **Recommendation** + **Rationale**
- **Warnings**: anything downstream tasks should know
- **Downstream action**: `continue` | `amend` | `escalate` — with short reason
- **Prerequisites confirmed**: runtime prerequisites that were verified during execution
