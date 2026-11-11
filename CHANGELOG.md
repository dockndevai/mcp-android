# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-11

### Security
- Strict mode (`*_REQUIRE_HUMAN_APPROVAL`) now refuses an action whose target's version cannot be read (it used to proceed unpinned), and the approval prompt no longer calls reversible changes (moves, config changes) irreversible.
- **Approval prompts are fully reviewable.** Arguments are shown in full up to 16 000 characters (previously cut at 1500, so a padded prefix could hide the tail of a long statement); a longer action is refused instead of approved blind. Secret redaction in prompts matches whole words (`bypass`/`tokenizer` are no longer shown as `[redacted]`).
- **Approval no longer fails open on timeout.** The human-approval prompt used the MCP SDK's default
  60 s request timeout, and a timeout fell through to "approved" (the `ANDROID_ALLOW_INSTALL` /
  `ANDROID_ALLOW_SHELL` gate had already passed). A prompt nobody answered therefore auto-approved a
  destructive operation. A timeout is now a refusal, and the wait defaults to 5 minutes.
- **Package names are validated** before they reach `adb shell` (`launch_app`, `uninstall_app`,
  `clear_app_data`): anything that is not a plain dotted identifier is rejected. `adb shell` joins its
  arguments into a string for the device shell, so an unvalidated name could carry shell syntax (and
  the new version probe runs before the human is asked).
- Dependencies: `@modelcontextprotocol/sdk` 1.32.1 -> 1.32.2, `npm audit fix` and `zod` 3 -> 4 (4.6.7)
  clear every advisory in the production tree (`npm audit --omit=dev` is clean; it previously reported
  `body-parser`, `fast-uri`, `qs` and a high `zod` memory-exhaustion advisory with no 3.x fix). No tool
  schema changed: a new test (`test/schemas.test.ts`) pins every tool's advertised input schema. The only
  differences in the generated JSON Schema are cosmetic and do not change what a tool accepts: zod 4 no
  longer emits `additionalProperties: false` (unknown keys are still stripped) and adds safe-integer
  bounds to integer fields.

- **Fixed shell injection in `input_text`, `open_url`, `set_alarm` and `set_timer`.** `adb shell` joins
  its arguments into one string that the device's shell parses, and these tools passed raw text/URLs/messages, so
  `a; rm -rf /sdcard/x`, `$(id)` or backticks ran on the device, even in `read-write` mode with
  `ANDROID_ALLOW_SHELL` off (the README/SECURITY claim "no shell injection" was false for them). Every device-shell
  command now goes through one helper (`src/adb/shell.ts`) that single-quotes each argument and gives adb a single
  string. Verified by tests that execute the handed-over string in a real POSIX shell.
- `input_text` handles `%s` correctly (a literal `%s` is typed in two steps instead of becoming a space), and numbers
  and keycodes are validated before they reach a command line.
- `open_url` refuses any URL scheme other than `http`, `https`, `tel`, `mailto`, `geo`, `market` (and any in the new
  `ANDROID_EXTRA_URL_SCHEMES`), and URLs containing control characters.
- `install_apk` resolves the APK path to an absolute path so a relative path starting with `-` cannot be read as an
  `adb install` option.

### Added
- `ANDROID_EXTRA_URL_SCHEMES` — comma-separated extra URL schemes `open_url` may open.
- **Approvals are bound to the exact action.** The prompt shows the tool, the full (secret-redacted)
  arguments and a fingerprint; every approval and refusal is written to the audit log as
  `"audit":"approval"` with the fingerprint, resource version and `approvedBy` (`human` / `flag-only`).
- **Approvals are bound to the target's version.** A version token is read before the prompt and again
  after the human answers, and the action is refused if it changed: `uninstall_app` and `clear_app_data`
  pin the installed versionName/versionCode, install/update times and the device; `install_apk` pins the
  APK file (size, mtime, inode) and the device; `run_shell` pins the device (serial + OS build).
- `ANDROID_REQUIRE_HUMAN_APPROVAL=true` — refuse destructive ops when the client cannot elicit.
- **Tool annotations.** Every tool now registers `readOnlyHint` / `destructiveHint` / `idempotentHint` /
  `openWorldHint`, derived from its capability (`src/tools/annotations.ts`).

Tracking issue: https://github.com/dockndevai/mcp-core/issues/1

## [0.1.0]

- Initial public release.
