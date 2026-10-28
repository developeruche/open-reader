# M1 feasibility spikes (throwaway)

Excluded from the product build, lint and typecheck. Results and conclusions are in `docs/adr/0003`–`0008`.

```bash
pnpm spikes:setup   # copies ORT, piper-wasm and the HeadTTS dictionary into spikes/extension/public
pnpm spikes:build   # wxt build spikes/extension
pnpm spikes:run     # Playwright driver; writes spikes/out/results.json
```

Model files are read from `models/cache/` (gitignored) through a localhost server started by the driver.
`lib/headtts/` is copied from met4citizen/HeadTTS@5ae6d5e (MIT, see its LICENSE).
