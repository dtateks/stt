# Task 02: Harden permission and text-insertion pipeline

- **Agent**: hades
- **Skills**: —
- **Wave**: 1
- **Complexity**: L

## Owns
- `src/src/permissions.rs` (modify)
- `src/src/text_inserter.rs` (modify)
- `src/tests/text_insertion_permissions.rs` (create)

## Entry References
- `src/src/permissions.rs:47` — microphone permission flow and status mapping
- `src/src/permissions.rs:106` — accessibility trust and prompt path
- `src/src/text_inserter.rs:48` — insert-text permission gate, insertion, and clipboard restore flow
- `src/src/text_inserter.rs:96` — automation permission contract
- `src/src/text_inserter.rs:197` — macOS clipboard snapshot/restore internals

## Exemplar
- `src/src/text_inserter.rs:164` — current focused unit tests around automation denial/error mapping show the expected testing style for fragile native behavior

## Produces
- `C-02-permission-insertion-contract`:
  - Signature: `MicrophonePermissionResult | AccessibilityPermissionResult | TextInsertionPermissionResult | InsertTextResult`
  - Behavior: All permission and insertion outcomes return structured, actionable results; permission gates happen before side effects; automation denial maps to user-guiding messages; insertion/clipboard failure paths are explicit and testable.
  - Validate: `cargo test --manifest-path src/Cargo.toml` passes, and new coverage proves denial, unexpected-error, and restore-path behavior.

## Consumes
- `None`

## Tests
- **Skip reason**: None

## Steps
1. Audit `permissions.rs` and `text_inserter.rs` together for duplicated policy, hidden failure paths, clipboard/data-loss risk, brittle timing assumptions, and mismatched user-facing error semantics.
2. Refactor the owned modules so permission checks, insertion attempts, and restore behavior are explicit, fail-fast, and consistently represented through structured result types instead of silent best-effort logic.
3. Preserve or improve actionable user guidance for Accessibility, Microphone, and Automation failures; do not replace explicit results with generic errors.
4. Add focused Rust coverage in `src/tests/text_insertion_permissions.rs` (and owned module tests if needed) for denial mapping, unexpected OS error propagation, restore-path behavior, and any new edge cases introduced by the refactor.

## Failure Modes
- **If clipboard restore cannot preserve a format safely**: document the exact unsupported format and escalate rather than silently discarding clipboard state.
- **If the clean fix needs shared boundary changes in `src/src/commands.rs` or UI bridge/types**: report the exact result-shape change for Task 07 instead of editing shared files.
- **If TCC/runtime behavior cannot be proven in unit tests**: lock the pure logic/result mapping in tests and surface the remaining live verification item for Task 08.

## Guardrails
- Do not introduce silent catches, empty error branches, or “best effort” success reporting for permission/insertion failures.
- Do not ship timing hacks or magic sleeps without making them explicit constants/rationale inside owned files.
- Do not weaken existing actionable permission messages.

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
