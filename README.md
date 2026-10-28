# Open Reader

Offline, reliable read-aloud for web pages and PDFs, as an unpacked Chrome extension.
Natural on-device voices; a highlight and a cursor follow the voice word by word.

For research and personal use only. Not published to the Chrome Web Store.

## Develop

```bash
pnpm install
pnpm dev            # Chrome with the extension loaded and HMR
pnpm build          # .output/chrome-mv3
```

Load the build: `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3`.

## Check

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

See [docs/PROGRESS.md](docs/PROGRESS.md) for status and [PLAN.md](PLAN.md) for the build plan.
