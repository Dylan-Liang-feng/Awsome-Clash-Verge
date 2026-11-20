# CONTRIBUTING

Thank you for your interest in contributing to **Clash Verge Rev**! This guide provides instructions to help you set up your development environment and start contributing effectively.

## Internationalization (i18n)

We welcome translations and improvements to existing locales.

<details>
<summary>Translation workflow and locale structure</summary>

Thanks for helping localize Clash Verge Rev. This guide reflects the current architecture, where the React frontend and the Tauri backend keep their translation bundles separate. Follow the steps below to keep both sides in sync without stepping on each other.

### Quick workflow

- Update the language folder under `src/locales/<lang>/`; use `src/locales/en/` as the canonical reference for keys and intent.
- Run `pnpm i18n:format` to align structure (frontend JSON + backend YAML) and `pnpm i18n:types` to refresh generated typings.
- If you touch backend copy, edit the matching YAML file in `crates/clash-verge-i18n/locales/<lang>.yml`.
- Preview UI changes with `pnpm dev` (desktop shell) or `pnpm web:dev` (web only).
- Keep PRs focused and add screenshots whenever layout could be affected by text length.

### Frontend locale structure

Each locale folder mirrors the namespaces under `src/locales/en/`:

```
src/locales/
  en/
    connections.json
    home.json
    shared.json
    ...
  zh/
    ...
```

- JSON files map to namespaces (for example `home.json` → `home.*`). Keep keys scoped to the file they belong to.
- `shared.json` stores reusable vocabulary (buttons, validations, etc.); feature-specific wording should live in the relevant namespace.
- `src/services/i18n.ts` automatically discovers and lazy-loads each locale's JSON sections, so no aggregate module is required. Keep locales aligned with `src/locales/en/`, and add new codes to `supportedLanguages`.

Because backend translations now live in their own directory, you no longer need to run `pnpm prebuild` just to sync locales—the frontend folder is the sole source of truth for web bundles.

### Tooling for i18n contributors

- `pnpm i18n:format` → `node scripts/cleanup-unused-i18n.mjs --align --apply`. It aligns key ordering, removes unused entries, and keeps all locales in lock-step with English across both JSON and YAML bundles.
- `pnpm i18n:check` performs a dry-run audit of frontend and backend keys. It scans TS/TSX usage plus Rust `t!(...)` calls in `src-tauri/` and `crates/` to spot missing or extra entries.
- `pnpm i18n:types` regenerates `src/types/generated/i18n-keys.ts` and `src/types/generated/i18n-resources.ts`, ensuring TypeScript catches invalid key usage.
- For dynamic keys that the analyzer cannot statically detect, add explicit references in code or update the script whitelist to avoid false positives.

### Backend (Tauri) locale bundles

Native UI strings (tray menu, notifications, dialogs) use `rust-i18n` with YAML bundles stored in `crates/clash-verge-i18n/locales/<lang>.yml`. These files are completely independent from the frontend JSON modules.

- Keep `en.yml` semantically aligned with the Simplified Chinese baseline (`zh.yml`). Other locales may temporarily copy English if no translation is available yet.
- When a backend feature introduces new strings, update every YAML file to keep the key set consistent. Missing keys fall back to the default language (`zh`), so catching gaps early avoids mixed-language output.
- The same `pnpm i18n:check` / `pnpm i18n:format` tooling now validates backend YAML keys against Rust usage, so run it after backend i18n edits.
- Rust code resolves the active language through the `clash-verge-i18n` crate (`crates/clash-verge-i18n/src/lib.rs`). No additional build step is required after editing YAML files; `tauri dev` and `tauri build` pick them up automatically.

### Adding a new language

1. Duplicate `src/locales/en/` into `src/locales/<new-lang>/` and translate the JSON files while preserving key structure.
2. Append the language code to `supportedLanguages` in `src/services/i18n.ts`.
3. If the backend should expose the language, create `crates/clash-verge-i18n/<new-lang>.yml` and translate the keys used in existing YAML files.
4. Run `pnpm i18n:format`, `pnpm i18n:types`, and (optionally) `pnpm i18n:check` in dry-run mode to confirm structure.

### Authoring guidelines

- **Reuse shared vocabulary** before introducing new phrases—check `shared.json` for common actions, statuses, and labels.
- **Prefer semantic keys** (`systemProxy`, `updateInterval`, `autoRefresh`) over positional ones (`item1`, `dialogTitle2`).
- **Document placeholders** using `{{placeholder}}` and ensure components supply the required values.
- **Group keys by UI responsibility** inside each namespace (`page`, `sections`, `forms`, `actions`, `tooltips`, `notifications`, `errors`, `tables`, `statuses`, etc.).
- **Keep strings concise** to avoid layout issues. If a translation needs more context, leave a PR note so reviewers can verify the UI.

### Testing & QA

- Launch the desktop shell with `pnpm dev` (or `pnpm web:dev`) and navigate through the affected views to confirm translations load and layouts behave.
- Run `pnpm test` if you touched code that consumes translations or adjusts formatting logic.
- For backend changes, trigger the relevant tray actions or notifications to verify the updated copy.
- Note any remaining untranslated sections or layout concerns in your PR description so maintainers can follow up.

### Feedback & support

- File an issue for missing context, tooling bugs, or localization gaps so we can track them.
- PRs that touch UI should include screenshots or GIFs whenever text length may affect layout.
- Mention the commands you ran (formatting, type generation, tests) in the PR checklist. If you need extra context or review help, request it via a PR comment.

</details>

## Contribution Expectations

We welcome AI-assisted contributions — AI assistance itself is not a problem. What we require is **ownership**: every pull request must show that the stated problem is understood and that the change deliberately solves it. Incoming pull requests from contributors without write access are screened by an automated review ([`pr-ai-slop-review`](.github/workflows/pr-ai-slop-review.md)) that evaluates this ownership evidence and may label high-risk submissions `ai-slop:med` or `ai-slop:high`. The policy is maintained in that file and compiled into `pr-ai-slop-review.lock.yml` (`gh aw compile`); never edit the lock file by hand. If you want to adjust the review policy, the easiest path is directing an AI coding agent to make the change — the workflow is documented in [AGENTS.md](AGENTS.md).

To make sure your contribution is assessed fairly:

- **Link a pre-existing issue.** Non-trivial changes should fix or implement something already reported in an issue. An issue created after the pull request is a much weaker signal than a genuine problem report.
- **Keep the diff mapped to the issue.** Every changed area should be explainable from the linked issue. Unrelated refactors, formatting churn, or dependency bumps belong in separate pull requests with their own motivation.
- **Describe the problem in your own words.** A short statement of what breaks or what is needed, and why this approach fixes it, is worth more than a long generated report.
- **Validate against the reported behavior.** Show how the reported problem was reproduced and confirmed fixed. Generic checklists and raw tool output are not verification.
- **Do not pad with tests or defensive code.** New tests are not expected by default. Add them only when the linked issue calls for them, keep them minimal, and explain in the pull request why each is necessary; speculative error handling and coverage of hypothetical failure modes inflate the diff without adding value.
- **Disclose AI automation.** If an AI agent produced or co-produced the change, end the pull request body with the model and effort level (for example, `Assisted by: GPT-5.6 High`; effort is optional when your tool does not report it). The PR template intentionally omits this footer; agents add it themselves. Disclosure is transparency only — it does not affect how the change is assessed.

If your pull request receives an `ai-slop` label, the fastest way to clear it is substantive: link (or ask us to create) the underlying issue, narrow the scope, or push implementation changes that respond to review feedback. Editing the pull request description alone does not change the assessment.

## Development Setup

Before contributing, you need to set up your development environment. Follow the steps below carefully.

### Prerequisites

1. **Install Rust and Node.js**  
   Follow the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your operating system. Use the Node.js version in [`.tool-versions`](.tool-versions); [`rust-toolchain.toml`](rust-toolchain.toml) selects the Rust version and required components when you run Cargo from this repository.

### Windows Users

> [!NOTE]  
> **Windows ARM users must also install [LLVM](https://github.com/llvm/llvm-project/releases) (including clang) and set the corresponding environment variables.**  
> The `ring` crate depends on `clang` when building on Windows ARM.

Additional steps for Windows:

- Ensure Rust and Node.js are added to your system `PATH`.

- Install the GNU `patch` tool.

- Use the MSVC toolchain for Rust:

```bash
rustup target add x86_64-pc-windows-msvc
rustup set default-host x86_64-pc-windows-msvc
```

### Install Node.js Package Manager

[Corepack is no longer bundled with Node.js starting with Node.js 25](https://nodejs.org/api/corepack.html). Install it globally if it is not already available, then enable it:

```bash
npm install --global corepack
corepack enable
```

Run pnpm from this repository so Corepack selects the version pinned by `packageManager` in [`package.json`](package.json).

### Install Project Dependencies

Node.js dependencies:

```bash
pnpm install --frozen-lockfile
```

Ubuntu-only system packages:

```bash
sudo apt-get install -y libxslt1.1 libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### Download the Mihomo Core Binary (Automatic)

```bash
pnpm run prebuild
pnpm run prebuild --force  # Re-download and overwrite Mihomo core and service binaries
```

### Prepare the Development Service Source

`pnpm dev` builds the development service from a sibling checkout of [`clash-verge-service-ipc`](https://github.com/clash-verge-rev/clash-verge-service-ipc). The binaries downloaded by `pnpm prebuild` do not replace this source checkout.

Check the `clash_verge_service_ipc` dependency in [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml), then clone the service repository alongside `clash-verge-rev` and check out the matching tag. If the sibling directory already exists, reuse it and check its version rather than overwriting it. Without this checkout, `pnpm dev` fails when it tries to access `../clash-verge-service-ipc/Cargo.toml`.

### Run the Development Server

Run these commands from the root of `clash-verge-rev`:

```bash
pnpm dev           # Build the development service and start the desktop app
pnpm dev:diff      # Alias of pnpm dev
pnpm dev:tauri     # Run Tauri directly with the tauri-dev feature
```

For frontend-only development, use `pnpm web:dev`. It does not start the Rust backend or build the development service.

### Build the Project

Standard build:

```bash
pnpm build
```

Fast build for testing:

```bash
pnpm build:fast
```

### Clean Build

```bash
pnpm clean
```

### Portable Version (Windows Only)

```bash
pnpm portable
```

## Contributing Your Changes

### Before Committing

**Code quality checks:**

```bash
# Rust backend
cargo clippy-all
# Frontend
pnpm lint
```

**Code formatting:**

```bash
# Rust backend
cargo fmt
# Frontend
pnpm format
```

### Signing your commit

Signed commits are required to verify authorship and ensure your contributions can be merged. Reference signing-commits [here](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

### Submitting Your Changes

1. Fork the repository.

2. Create a new branch for your feature or bug fix.

3. Commit your changes with clear messages and make sure it's signed.

4. Push your branch and submit a pull request.

We appreciate your contributions and look forward to your participation!
