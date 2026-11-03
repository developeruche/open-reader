# Contributing to Open Reader

Thanks for helping. This guide covers how to report a problem, how to build and run Open Reader
from source, how the code is organized, and what a change needs before it can be merged.

## Reporting a bug or asking for a feature

- **Bugs:** open an issue with what you did, what you expected and what happened. Add the
  diagnostics report: Options → **Diagnostics** → **Copy diagnostics**. It records the engine,
  backend, timings and recent errors, and never contains document text, page titles or URLs. If
  the problem is with one page or PDF, say whether it is public so others can try it.
- **Ideas:** open an issue first for anything larger than a small fix, so we can agree on the
  approach before you spend time on it.
- **Security problems:** please don't open a public issue. Contact the maintainer privately
  through GitHub.

## Setting up

You need:

- Node.js 22 and pnpm 10.9 (`corepack enable` sets up the right pnpm from `package.json`)
- Chrome 116 or later on a desktop computer
- Optional: [uv](https://docs.astral.sh/uv/) for the speech-quality harness in `quality/`

```bash
pnpm install
pnpm exec playwright install chromium
```

`pnpm install` also installs the Git hooks (lefthook). They run ESLint, Prettier and the related
unit tests on every commit.

### Run it

```bash
pnpm dev            # Chrome with the extension loaded and hot reload
pnpm build          # production build in output/chrome-mv3
pnpm zip            # output/open-reader-<version>-chrome.zip
pnpm zip:store      # the same, without the manifest key, for the Chrome Web Store
```

To load a build into your own Chrome: open `chrome://extensions`, turn on **Developer mode**, press
**Load unpacked**, and choose `output/chrome-mv3`.

**Updating a loaded build:** after `pnpm build`, press the reload icon on the Open Reader card.
Don't use **Remove** and **Load unpacked** again. The manifest `key` in `wxt.config.ts` fixes the
extension ID to `ciacahokbkkhcpoefghbmnmilbaalcem`, so downloaded voices, settings and stored PDFs
survive rebuilds, and even loading the build from another folder. **Remove** deletes all of them,
and you would have to download the voice again. Keep only one copy of Open Reader loaded at a
time.

To read local PDFs, open the extension's **Details** and turn on **Allow access to file URLs**.

## How the code is organized

```
src/
  core/        Pure TypeScript, no browser APIs: document model, text normalization and
               segmentation, the player state machine, audio processing, model manager
  engines/     Voice engines (Kokoro, Piper, system voices, a test tone) behind one interface,
               running in workers with ONNX Runtime Web (WebGPU, then WASM)
  web/         Web mode: Readability extraction, mapping text back to the page, highlights,
               the floating player
  pdf/         Document mode: PDF.js viewer, reading-order layout, text-layer mapping, OCR
  runtime/     The background orchestrator, engine hosts and the UI ↔ background protocol
  platform/    Every chrome.* call lives here: storage, tabs, offscreen, downloads, OPFS
  ui/          React components, design tokens, the side panel, options and reader shells
  entrypoints/ WXT entry points (background, content script, side panel, options, reader,
               offscreen, onboarding, and a component gallery that is left out of production)
tests/
  unit/        Vitest with happy-dom and a fake chrome API
  browser/     Vitest in real Chromium, for DOM APIs happy-dom lacks
  e2e/         Playwright against the built extension
  models/      Playwright with the real voice models
  fixtures/    Web pages, PDFs (with golden reading-order files) and text corpora
quality/       Python ASR harness that scores voices for intelligibility
scripts/       Model fetching, fixtures, icons, license and size checks, screenshots
models/        registry.json: every model, pinned revision, file hashes and license
```

Further reading:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit together
- [docs/MODELS.md](docs/MODELS.md): the voices, and how to add a model or an engine
- [docs/TESTING.md](docs/TESTING.md): the test suites, performance targets and results
- [docs/PRIVACY.md](docs/PRIVACY.md): network use, permissions and what is stored where
- [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md): every dependency and its license
- [docs/adr/](docs/adr/): architecture decision records

## Project rules

These keep Open Reader private, offline and maintainable. Reviews check them.

- **Offline first.** After the voice download, nothing may need the network. No analytics, no
  telemetry, no remote code, no CDN assets. Everything ships in the extension.
- **Never commit** model weights, API keys or tokens, user documents, or build output.
  `.gitignore` covers the usual paths (`output/`, `models/cache/`, `*.onnx`, …).
- **Dependencies:** use pnpm and pin exact versions (no `^` or `~`). Every new package needs a
  license check (`pnpm licenses:check` enforces an allowlist) and an entry in
  [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md). New models also go in
  [docs/MODELS.md](docs/MODELS.md) with their license.
- **TypeScript:** strict mode, and no `any`. Validate anything that crosses a process boundary
  (messages, storage) with zod.
- **Browser APIs:** every `chrome.*` call goes in `src/platform/**`, so the rest can be tested
  without a browser.
- **Accessibility:** UI must meet WCAG 2.2 AA in light and dark mode, work with the keyboard and
  respect reduced motion. The axe audit in `tests/e2e/a11y.spec.ts` fails on serious findings.
- **Size budgets:** `pnpm budgets` fails if a bundle grows past its budget
  (`scripts/check-budgets.ts`).
- **Decisions:** a change to architecture, a dependency or a trade-off gets a short ADR in
  `docs/adr/` (context, decision, consequences), numbered after the last one.

## Testing

Every change must pass the full suite before it is merged:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
pnpm budgets        # bundle-size budgets, after pnpm build
```

When you change an engine, the audio pipeline or the model manager, also run the suites with real
models. The weights download once into `models/cache/`, which is gitignored:

```bash
pnpm models:fetch all
pnpm test:models    # real engines, latency and accuracy targets, offline reading
```

Other suites:

| Command               | What it does                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm test:coverage`  | Unit tests with coverage thresholds (90% for `src/core`)                                            |
| `pnpm test:soak`      | Reads for 10 minutes and checks for errors, stalls, buffering and highlight drift                   |
| `pnpm synth:corpus`   | Renders the test passages with every voice into `quality/out/`                                      |
| `pnpm quality`        | Scores those recordings with speech recognition (needs uv)                                          |
| `pnpm fixtures`       | Regenerates the PDF fixtures and their golden reading order                                         |
| `pnpm screenshots`    | Retakes `docs/images/*.png` with the real Kokoro voice (after `pnpm build:test` and `models:fetch`) |
| `pnpm promo-tiles`    | Redraws the Chrome Web Store promo tiles in `docs/store/`                                           |
| `pnpm licenses:check` | Checks every dependency against the license allowlist                                               |

The E2E and model tests build the extension in test mode (`output/chrome-mv3-test`), which adds
test hooks and a deterministic test-tone voice. Each test runs in a fresh Chrome profile that is
deleted afterwards.

For changes you can't fully test automatically (how a voice sounds, highlights on a real site),
list the steps you checked by hand in the pull request, so a reviewer can repeat them.

## License of contributions

Open Reader is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE). Unless you
say otherwise, any contribution you submit for inclusion is licensed the same way, without any
additional terms or conditions.

## Making a pull request

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one change, with tests. Bug fixes should include a test that fails
   without the fix.
3. Write commit messages as a short imperative summary, for example
   `Keep the highlight on the word after a seek`.
4. Run the full suite above, and say in the pull request which extra suites you ran (models, soak)
   and what you checked by hand.
5. Update the docs that your change affects: the README for anything users see, and the docs and
   ADRs for anything developers need to know.

## Releasing

1. Bump `version` in `package.json` (it becomes the manifest version).
2. Run the full suite, including `pnpm test:models`.
3. `pnpm zip` and attach the zip to a GitHub release.
4. For the Chrome Web Store, upload the zip from `pnpm zip:store` (`pnpm build:store` builds the
   same thing unzipped, for checking it first). It differs from the normal build in two ways:
   - there is no manifest `key`, because the store assigns its own ID and rejects uploads that set
     one;
   - voices whose license is for research or personal use only (the Piper lessac voices) are left
     out.
