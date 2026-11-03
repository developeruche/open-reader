# Privacy policy

_Last updated: 3 November 2026_

Open Reader reads web pages and PDFs aloud with voices that run on your own computer. This policy
explains what it does with your data. In short: **Open Reader collects nothing, and nothing you
read leaves your computer.**

## What Open Reader does not do

- It has no account, no analytics, no telemetry, no crash reporting and no advertising.
- It never sends the text of a page or PDF, its title or its address anywhere.
- It does not sell or share any data with anyone, because it has none to share.
- It does not run on a page until you ask it to read that page.

## Network use

Open Reader goes online only when you ask it to:

- **Voice downloads** that you start, during onboarding or in Options → Voices & models. The files
  come from Hugging Face at fixed versions, and each one is checked against a known SHA-256
  fingerprint before it is used. Hugging Face sees an ordinary download request from your
  browser.
- **A PDF you open from a link** (a PDF tab, a link's right-click menu, or the optional "Open PDF
  links in Open Reader" setting) is downloaded by the reader so it can be read. Chrome sends the
  usual cookies for that site, exactly as it would if you opened the PDF yourself.

After a voice is installed, reading works with no network connection at all.

Chrome's own online voices (for example "Google US English") send text to Google. Open Reader
hides them while **Strict offline** is on, which is the default. If you turn it off and choose one
of those voices, Google's privacy policy applies to that text. Open Reader has no online voices of
its own.

## Permissions and why they are needed

| Permission                            | Why                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read and change data on all websites  | When you press **Read this page**, Open Reader reads the article's text and highlights each word as it is spoken. It is injected only into the tab you ask it to read, and only when you ask. |
| `activeTab`, `scripting`              | Injecting the reader into the page you ask it to read                                                                                                                                         |
| `sidePanel`, `contextMenus`           | The side panel player and the right-click entries (**Read this page**, **Read selection aloud**, **Open a PDF…**)                                                                             |
| `offscreen`                           | Playing audio for web pages while you use other tabs                                                                                                                                          |
| `storage`, `unlimitedStorage`         | Settings, your reading position, and the voices (a few hundred megabytes) stored on your computer                                                                                             |
| `tts`                                 | Your computer's built-in voices, used before a voice is downloaded or as a fallback                                                                                                           |
| `downloads`                           | Saving the audiobooks you export to your Downloads folder                                                                                                                                     |
| `declarativeNetRequestWithHostAccess` | The optional "Open PDF links in Open Reader" setting, which is off by default                                                                                                                 |

## What is stored on your computer

Everything below stays in your Chrome profile on this computer. None of it is synced or uploaded.

| Where                                    | What                                                                                          | How long                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| `chrome.storage.session`                 | The current reading session (title, address, position, speed, voice) and the document's text  | Until you close the browser |
| `chrome.storage.local`                   | Your settings and appearance                                                                  | Until removed               |
| IndexedDB → `audio`                      | Speech for recently read sentences, so going back is instant (up to 512 MB, oldest first out) | Until evicted or cleared    |
| IndexedDB → `library`                    | Title, address and last position of documents you read (the **Recent** list)                  | Until removed               |
| IndexedDB → `lexicon`                    | Your pronunciations                                                                           | Until removed               |
| IndexedDB → `docRules`                   | Reading rules you chose for a page or PDF                                                     | Until removed               |
| IndexedDB → `ocr`                        | Text recognized on scanned PDF pages                                                          | Until removed               |
| Origin private file system: `models/`    | The voice models you installed                                                                | Until removed               |
| Origin private file system: `documents/` | Copies of PDFs you open in the reader, so they reopen after a restart                         | Until removed               |
| Origin private file system: `exports/`   | An audiobook while it is being made                                                           | Deleted once it is saved    |

**Removing your data:** Options → **Storage** clears the audio cache and stored PDFs, and Options →
**Voices & models** removes voices. Removing Open Reader from Chrome deletes everything it stored.

## Diagnostics

Open Reader keeps a short log of events, states and errors in memory to help with problems. It
never contains document text, titles or addresses. Options → Diagnostics → **Copy diagnostics**
puts the log on your clipboard only when you press it, so you can choose to include it in a bug
report. Anything named like a key, token, secret or password is replaced with `[redacted]`.

## Changes and contact

If this policy changes, the new version will be published here with a new date. Questions are
welcome as an issue on the project's GitHub page.
