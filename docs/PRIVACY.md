# Privacy

Open Reader collects nothing. No analytics, no telemetry.

## Network

The only network calls are model downloads the owner starts and, if turned on, online voices.

## Permissions

`host_permissions: ["<all_urls>"]` lets the content script read and highlight any page the owner
asks it to read. This is a personal-use build; broad access is accepted in exchange for not
prompting per site. Details of what is stored where are added as storage lands (M4–M6).

## What is stored where (from M5)

| Store                               | Contents                                                                                                      | Lifetime                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `chrome.storage.session`            | The current reading session (document id, title, URL, position, speed, voice) and the current document's text | Until the browser closes |
| `chrome.storage.local`              | Appearance and, later, settings                                                                               | Until removed            |
| IndexedDB `open-reader` → `audio`   | Synthesized audio for recently read sentences (LRU, 512 MB cap)                                               | Until evicted or cleared |
| IndexedDB `open-reader` → `library` | Title, URL and last position of documents you read                                                            | Until removed            |

Document text is stored only on this device and never sent anywhere.
