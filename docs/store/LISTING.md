# Chrome Web Store listing

Copy-ready text for each field of the Chrome Web Store developer dashboard. Upload the zip from
`pnpm zip:store` (`output/open-reader-<version>-chrome.zip`).

## Store listing

**Name:** Open Reader

**Summary** (132 characters at most):

> Listen to articles and PDFs in a natural voice, with each word highlighted. Runs on your
> computer: private, free and offline.

**Category:** Accessibility

**Language:** English

**Description:**

> Open Reader reads web pages and PDFs aloud in a natural voice, and highlights every word as it
> is spoken so you can follow along.
>
> The voices run on your own computer. Nothing you read is sent anywhere, there is no account and
> no subscription, and it keeps working without an internet connection.
>
> WHAT IT DOES
> • Reads the main text of an article and skips menus, ads and footers
> • Highlights the current sentence and word, on the page and in the side panel, and scrolls with
> the voice
> • Reads PDFs, including two-column papers, and leaves out running headers, page numbers and
> reference lists; scanned pages are recognized on your computer
> • Natural voices (Kokoro) and a lighter voice for slower computers (Piper)
> • Speed from 0.5× to 4×, without the voice going squeaky
> • Click any sentence to jump to it; pick up where you left off later
> • Sleep timer, custom pronunciations, and audiobook export to MP3 with chapters
> • Keyboard shortcuts that work in any tab (Alt+Shift+P to play or pause)
>
> HOW TO USE IT
> Open an article, click the Open Reader icon, and press "Read this page". For a PDF, press the PDF
> button in the side panel and choose a file.
>
> The first time, Open Reader downloads its voice once (about 330 MB, or about 90 MB on computers
> without a capable graphics chip). Until then it reads with your computer's built-in voices.
>
> PRIVATE BY DESIGN
> No analytics, no tracking, no account. The only network use is the one-time voice download, and
> PDFs you open from a link. Free and open source under the MIT or Apache-2.0 license.

**Graphics:**

| Asset              | File                                                 |
| ------------------ | ---------------------------------------------------- |
| Icon (128×128)     | `public/icon/128.png`                                |
| Screenshot 1       | `docs/images/web.png` (1280×800): reading an article |
| Screenshot 2       | `docs/images/pdf.png` (1280×800): reading a PDF      |
| Small promo tile   | `docs/store/promo-small-440x280.png`                 |
| Marquee promo tile | `docs/store/promo-marquee-1400x560.png`              |

Regenerate both promo tiles with `pnpm promo-tiles` (after `pnpm screenshots` if the UI changed).
**Links:**

- Homepage: https://github.com/developeruche/open-reader
- Support: https://github.com/developeruche/open-reader/issues

The repository must be public for these links, and the privacy policy link, to work.

## Privacy practices

**Single purpose:**

> Open Reader reads web pages and PDFs aloud with on-device text-to-speech, highlighting each word
> as it is spoken.

**Permission justifications:**

| Permission                            | Justification                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host permission (`<all_urls>`)        | When the user presses "Read this page", the extension reads the article text of that tab and highlights each word as it is spoken. It works on any site the user chooses, and does nothing on a page until asked. It also lets the reader fetch a PDF the user opens from a link. |
| `activeTab`                           | Access to the tab the user asks to read, when started from the toolbar, context menu or a keyboard shortcut.                                                                                                                                                                      |
| `scripting`                           | Injects the reading script (text extraction, highlights, floating player) into the tab the user asks to read, only on demand.                                                                                                                                                     |
| `sidePanel`                           | The side panel is the main player: controls, the document's text and settings.                                                                                                                                                                                                    |
| `contextMenus`                        | Right-click entries: "Read this page", "Read page from here", "Read selection aloud" and "Open a PDF…".                                                                                                                                                                           |
| `offscreen`                           | An offscreen document runs the on-device voice model and plays audio while the user is in other tabs.                                                                                                                                                                             |
| `storage`                             | Saves settings, the current reading position and the list of recent documents on the user's computer.                                                                                                                                                                             |
| `unlimitedStorage`                    | The voice models (100–400 MB) and copies of opened PDFs are stored locally so reading works offline.                                                                                                                                                                              |
| `tts`                                 | Uses the computer's built-in voices before a voice model is downloaded, and as a fallback.                                                                                                                                                                                        |
| `downloads`                           | Saves audiobooks the user exports (MP3 or WAV) to the Downloads folder.                                                                                                                                                                                                           |
| `declarativeNetRequestWithHostAccess` | An optional setting, off by default, that opens PDF links in Open Reader's PDF reader instead of Chrome's viewer.                                                                                                                                                                 |

**Remote code:** No. All code, including the WebAssembly voice engine, is in the package. The voice
models downloaded from Hugging Face are data files (neural network weights), checked against a
SHA-256 hash, and are not executable code.

**Data usage:** Open Reader does not collect or transmit any user data. In the form, tick none
of the data types. Then confirm the three statements (no selling of data, no use unrelated to the
single purpose, no use for creditworthiness or lending) only if you agree they are true; they are
true of the code as written.

**Privacy policy URL:** https://github.com/developeruche/open-reader/blob/main/docs/PRIVACY.md

## Distribution

- Visibility: Public
- Regions: all
- Price: free
