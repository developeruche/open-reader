# Open Reader

Read-aloud for web pages and PDFs that works offline. Natural voices run on your device, and a
highlight and a thin cursor follow the voice word by word.

For research and personal use. Not published to the Chrome Web Store.

## Install (unpacked)

You need Chrome 116 or later on a desktop computer.

1. Build it, or use a zip from a release:
   ```bash
   pnpm install
   pnpm build
   ```
   The extension is in `output/chrome-mv3`. (`pnpm zip` makes `output/open-reader-1.0.0-chrome.zip`;
   unzip it first.)
2. Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and choose the
   `output/chrome-mv3` folder.
3. Pin Open Reader from the puzzle-piece menu so its icon is always visible.

**Updating:** after `pnpm build`, press the reload icon on the Open Reader card in
`chrome://extensions`. The extension always has the same ID
(`ciacahokbkkhcpoefghbmnmilbaalcem`, fixed by the manifest key), so voices, settings and stored
PDFs survive rebuilds, and even loading the build from another folder. **Remove** deletes all of
them, so prefer reload. Keep only one copy of Open Reader loaded at a time.

To read PDFs stored on your computer, open the extension's **Details** and turn on **Allow access
to file URLs**.

## First run

A welcome page opens after installing. It:

1. downloads the default voice, _Kokoro Heart_: natural, with exact word timings. It is a
   one-time ~330 MB download with WebGPU, or ~90 MB without;
2. checks this computer with a short benchmark and suggests the faster voice (Piper) if needed;
3. lets you pick a voice, and shows the three shortcuts to remember.

Until a voice is installed, Open Reader reads with your system's voices.

After the download, everything runs offline: no account, no telemetry, and no document text
leaves your computer.

## Everyday use

- **Read a web page:** open the article, click the Open Reader icon, and press **Read this page**.
  Or press Alt+Shift+P on the page, or right-click the icon and choose **Read this page**. The side
  panel always shows the tab in front: switch to another article and press **Read this page** to
  hear it instead. Whatever is playing elsewhere stays in a bar at the top, with **Go to tab**.
- **Read a PDF:** press the PDF button at the top of the side panel (or **Open a PDF from your
  computer**, or right-click the Open Reader icon → **Open a PDF…**) and choose a file or drop it
  on the page. For a PDF open in a tab, the side panel offers **Read this PDF**. Two-column layouts,
  running headers, page numbers and references are handled, and scanned pages are recognized on
  your device. Options → Reading rules can open every PDF link in Open Reader.
- **Pick up where you left off:** the side panel's **Recent** list reopens an article at your
  position, or a PDF from its saved copy. Closing a tab ends its reading, and reading it again
  later resumes.
- **Jump around:** click any sentence in the side panel, or Alt+click a word on the page. Select
  text and press **Play from here**.
- **Speed, voice, pauses:** in the side panel or the floating player, from 0.5× to 4×.
- **Sleep timer, rules for one page, audiobook export:** side panel → **Settings**, or the reader's
  **Reading options** drawer. Exports are MP3 (64 kbps, with a chapter per heading) or WAV at
  −17 LUFS, saved to Downloads.
- **Pronunciations:** Options → Pronunciations. Add a word, press **Test** to hear it, and import
  or export the list as JSON.

## Keyboard shortcuts

| Action                              | Keys                      |
| ----------------------------------- | ------------------------- |
| Open the side panel                 | Alt+Shift+O               |
| Play or pause (anywhere)            | Alt+Shift+P               |
| Next / previous sentence (anywhere) | Alt+Shift+. / Alt+Shift+, |
| Play or pause                       | Space                     |
| Previous / next sentence            | J / K                     |
| Previous / next paragraph           | Shift+J / Shift+K         |
| Slower / faster                     | − / =                     |
| Follow on or off                    | F                         |
| Stop                                | Esc                       |

The first four work in any tab; change them at `chrome://extensions/shortcuts`. The rest work on
the page being read, in the side panel and in the reader.

## Troubleshooting

| What you see                                     | What to do                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This page can't be read"                        | Chrome blocks extensions on `chrome://` pages and the Web Store. For a PDF, use **Open a PDF…**.                                                               |
| "No readable text was found"                     | The page draws text in a way Readability can't find. Select the text and choose **Read selection aloud**.                                                      |
| A local PDF won't open                           | Turn on **Allow access to file URLs** in the extension's Details.                                                                                              |
| The voice is slow or stops between sentences     | Options → Voices & models → **Run benchmark**, then choose the voice it recommends (Piper is the fastest). A notice suggests this when synthesis falls behind. |
| "Switched to … because … failed"                 | The voice could not run on this backend, so the next one took over (WASM, then Piper, then system voices). Diagnostics has the details.                        |
| No sound                                         | Check that the tab isn't muted and that the system output device is right. Options → Diagnostics shows the engine state.                                       |
| Highlights are off on a page that changes itself | Some pages re-render while you read. Reading continues in the side panel; press **Read this page** again to re-attach.                                         |
| The voice downloads again after every build      | Use the reload icon instead of **Remove** + **Load unpacked**. Builds before this change had a different ID per folder, each with its own storage.             |
| Storage is full                                  | Options → Storage: lower the audio cache limit, clear it, or remove stored PDFs. Request persistent storage there so Chrome keeps models when space is low.    |

Options → Diagnostics → **Copy diagnostics** puts a report on your clipboard. It never contains
document text, page titles or URLs.

## Privacy

See [docs/PRIVACY.md](docs/PRIVACY.md). In short: model downloads from Hugging Face (pinned
revisions, checked by SHA-256) are the only network traffic. Everything you read, and every
setting, stays in this Chrome profile.

## Develop

```bash
pnpm install
pnpm dev            # Chrome with the extension loaded and HMR
pnpm build          # output/chrome-mv3
```

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
pnpm budgets        # bundle-size budgets (after pnpm build)
pnpm test:soak      # 10-minute soak
pnpm models:fetch all && pnpm test:models    # real engines, SLOs, offline read
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit
- [docs/MODELS.md](docs/MODELS.md): the voices, and adding a model or engine
- [docs/TESTING.md](docs/TESTING.md): test suites, SLO results, the quality harness
- [docs/PRIVACY.md](docs/PRIVACY.md), [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md): data and licenses
- [docs/PROGRESS.md](docs/PROGRESS.md) and `docs/adr/`: milestones and decisions
