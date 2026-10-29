# Privacy

Open Reader collects nothing. No analytics, no telemetry.

## Network

Open Reader makes network requests only when you ask it to:

- **Model downloads** you start (onboarding or Options → Voices & models), from Hugging Face at
  pinned revisions, each file checked against its SHA-256.
- **A PDF you open by URL** (a PDF tab, a link's context menu, or the optional PDF redirect) is
  downloaded by the reader so it can be read; Chrome sends it the usual cookies for that site.

Chrome's own online system voices (for example "Google US English") send text to Google. They are
hidden while **Strict offline** is on, which is the default. Open Reader has no online voices of
its own (M12 was not built).

## Permissions

`host_permissions: ["<all_urls>"]` lets the content script read and highlight any page the owner
asks it to read. This is a personal-use build; broad access is accepted in exchange for not
prompting per site. The other permissions:

| Permission                                            | Why                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `sidePanel`, `contextMenus`, `activeTab`, `scripting` | The side panel, the right-click entries, and injecting the reader into the page you ask it to read |
| `offscreen`                                           | The engine host that plays audio for web pages                                                     |
| `storage`, `unlimitedStorage`                         | Settings, the session, and models in OPFS                                                          |
| `tts`                                                 | System voices                                                                                      |
| `downloads`                                           | Saving audiobook exports                                                                           |
| `declarativeNetRequestWithHostAccess`                 | The optional "Open PDF links in Open Reader" redirect (off by default)                             |

## What is stored where (from M5)

| Store                                | Contents                                                                                                      | Lifetime                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `chrome.storage.session`             | The current reading session (document id, title, URL, position, speed, voice) and the current document's text | Until the browser closes |
| `chrome.storage.local`               | Appearance and, later, settings                                                                               | Until removed            |
| IndexedDB `open-reader` → `audio`    | Synthesized audio for recently read sentences (LRU, 512 MB cap)                                               | Until evicted or cleared |
| IndexedDB `open-reader` → `library`  | Title, URL and last position of documents you read                                                            | Until removed            |
| IndexedDB `open-reader` → `lexicon`  | Your pronunciations                                                                                           | Until removed            |
| IndexedDB `open-reader` → `docRules` | Reading rules you chose for a page or PDF                                                                     | Until removed            |
| IndexedDB `open-reader` → `ocr`      | Text recognized on scanned PDF pages, on this device                                                          | Until removed            |
| OPFS `exports/`                      | An audiobook while it is being made                                                                           | Deleted once it is saved |
| OPFS `documents/`                    | Copies of PDFs you open in the reader, named by content hash, so they reopen after a restart                  | Until removed            |

Document text and PDFs are stored only on this device and never sent anywhere.

Diagnostics (M10) keep a log of events, states and errors in the service worker's memory, never
document text, titles or URLs. **Copy diagnostics** puts a JSON report on your clipboard only when you
press it; keys named like an API key, token, secret or password are replaced with `[redacted]`. `reader.html` is a
web-accessible resource only so the optional PDF redirect can open it; it reads nothing until you
open a document.
