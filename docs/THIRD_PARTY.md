# Third-party software

Every dependency's license is checked by `pnpm licenses:check` (allowlist in
`scripts/check-licenses.ts`). Model licenses are in [MODELS.md](MODELS.md).

## Runtime dependencies (bundled into the extension)

| Package                                                    | Version | License                                                                                     |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| onnxruntime-web, onnxruntime-common                        | 1.31.1  | MIT                                                                                         |
| @diffusionstudio/piper-wasm                                | 1.0.0   | MIT package; `piper_phonemize` contains **espeak-ng (GPL-3.0)** and its data                |
| HeadTTS en-us G2P (vendored, `src/engines/kokoro/headtts`) | —       | MIT; its dictionary is a CMUdict 0.07 derivative (BSD-2-Clause, header kept in the file)    |
| pdfjs-dist                                                 | 6.4.299 | Apache-2.0                                                                                  |
| @mozilla/readability                                       | 0.6.0   | Apache-2.0                                                                                  |
| tesseract.js, tesseract.js-core                            | 7.0.0   | Apache-2.0                                                                                  |
| @tesseract.js-data/eng                                     | 1.0.0   | MIT package; the English `best_int` traineddata is Apache-2.0 (tesseract-ocr/tessdata_best) |
| wasm-media-encoders                                        | 0.7.0   | MIT; its MP3 encoder is **LAME (LGPL-2.0)**, shipped as a separate, replaceable `mp3.wasm`  |
| react, react-dom                                           | 19.3.1  | MIT                                                                                         |
| radix-ui                                                   | 1.8.1   | MIT                                                                                         |
| lucide-react                                               | 1.63.0  | ISC                                                                                         |
| xstate                                                     | 5.33.3  | MIT                                                                                         |
| zod                                                        | 4.6.7   | MIT                                                                                         |
| zustand                                                    | 5.0.16  | MIT                                                                                         |
| comlink                                                    | 4.4.2   | Apache-2.0                                                                                  |
| idb                                                        | 8.0.4   | ISC                                                                                         |
| clsx                                                       | 2.1.1   | MIT                                                                                         |
| Geist, Geist Mono, Newsreader (@fontsource-variable)       | 5.3.0   | SIL OFL-1.1                                                                                 |

Because espeak-ng (GPL-3.0) and LAME (LGPL-2.0) are bundled, a build that includes Piper or MP3
export carries those terms; this is a personal-use build that is not distributed. Model licenses
are in [MODELS.md](MODELS.md).

## Build and test tools

WXT (MIT), Vite (MIT), TypeScript (Apache-2.0), Tailwind CSS (MIT), ESLint (MIT),
typescript-eslint (MIT), Prettier (MIT), Vitest (MIT), Playwright (Apache-2.0), happy-dom (MIT),
lefthook (MIT), tsx (MIT), pdf-lib (MIT, fixtures only), Testing Library (MIT), axe-core / @axe-core/playwright (MPL-2.0), fast-check (MIT), fake-indexeddb (Apache-2.0), @xstate/graph (MIT), music-metadata (MIT, tests only).

## Design skills (not shipped)

frontend-design (Apache-2.0, see its LICENSE.txt), minimalist-ui (MIT), web-design-guidelines (MIT),
accessibility (MIT).
