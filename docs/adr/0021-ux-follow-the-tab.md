# 0021: The side panel follows the tab in front (post-1.0 UX pass)

## Context

The owner's first real use of 1.0.0 found two problems, and a UX audit against Speechify, Read
Aloud and Edge's Read Aloud found more:

1. After one article, the panel stayed on it. Switching to another article, closing the first tab
   or navigating it to another page still showed the old article and resumed it on Play.
2. "Open a PDF…" in the ⋯ menu opened Settings (it called `openOptions`), and the only other way to
   PDFs was hidden in that menu.
3. Alt+Shift+P ("play anywhere") resumed a paused article in another tab instead of the page in
   front.
4. "Read this page" was offered on pages Chrome won't let extensions read (chrome://, extension
   pages, the Web Store) and then failed with an error.
5. There was no way back to earlier articles or PDFs from the panel; PDFs only had a list on the
   reader's empty page.
6. While something played in another tab, there was no way to find that tab.
7. A finished article gave no hint about what to do next.

## Decisions

- **The panel follows the active tab of its window** (`watchActiveTab`: tab switches, navigation,
  title changes, closing). The full player shows only when the session belongs to the tab in front.
  Otherwise the panel shows a **start view**:
  - a **now-playing bar** for a session in another tab, with play/pause and **Go to tab**;
  - a **This tab** card: **Read this page** for an article, **Read this PDF** for a PDF tab, or an
    explanation for pages that can't be read;
  - **Open a PDF from your computer**;
  - **Recent**: an article reopens (or its tab is focused) and continues from the saved position;
    a PDF opens from the stored copy.
- **A session ends with its page.** Closing the tab, or navigating it to a different document
  (fragment changes don't count), unloads the session. The position is already saved, so reading
  the page again resumes it.
- **Play anywhere** reads the tab in front when nothing is playing there and the paused session
  belongs to another tab; while something plays, it pauses as before.
- **PDF entry points** are visible everywhere: a PDF icon button in the panel header, the start
  view, the ⋯ menu (now correct), the toolbar icon's right-click menu (**Read this page**, **Open a
  PDF…**), and the Options sidebar. Onboarding's last step names them.
- **Finished** articles show "Finished. Press Play to listen again…".

## Not done (recorded for later)

- A floating listen button injected into every article, as Speechify does. That needs a content
  script on every page, and the extension injects only on demand (performance and privacy).
- Auto-reading when the toolbar icon is clicked (Read Aloud's behaviour): one click already opens
  the panel with one big **Read this page**, and Alt+Shift+P starts reading without the panel.
