# 0019: Power features and audiobook export (M11)

## Decisions

- **Pronunciations.** User entries live in IndexedDB (`open-reader` v3 → `lexicon`), validated with
  zod (`StoredEntrySchema`). Each session carries `{ user, packs }`. Changes bump
  `settings.lexiconRevision`; the background and the reader watch settings and send `SET_LEXICON`,
  so the host re-plans upcoming segments without restarting. Packs (Programming, Bitcoin and
  Ethereum) can be turned off. The Test button speaks "Say ‹word›." through the real normalizer
  with the entry applied, in the current voice. Import/export is a versioned JSON file
  (`open-reader-lexicon`, v1); an import merges by written form. Delete has an Undo toast.
- **Rules for one document** are stored per document (`docRules` store) and override the defaults
  from Settings. Changing them re-applies the rules to the stored document, maps the position
  through its sentence id, and reloads the host at the same place (playing if it was).
- **Sleep timer** (`src/core/player/sleep.ts`): minutes, or the end of the current section (the
  next heading). It is checked on host status at sentence boundaries, so it never cuts a word. It
  fires only on a `playing` status: the `buffering` between segments must not expire it (an E2E
  run caught that). The timer is part of the session (`storage.session`), so a service worker
  restart keeps it; the reader runs its own for PDFs.
- **Speed up to 4× and pacing presets** were already in place (M4/M7). Options → Playback now saves
  the defaults.
- **Shared planner and renderer** (`src/core/player/render.ts`): the player and the export use the
  same `sentenceSegments` and `renderSegment` (cache, synthesis, trim, loudness, pauses), so an
  export sounds exactly like playback.
- **Serialized engine** (`serialized()`): playback and export share one engine, and calls run one
  at a time (an ONNX session must not run concurrently). Prefetch waits at most one export segment.
- **Audiobook export** (`src/runtime/export.ts`) runs in the host that reads the document (the
  offscreen document for web pages, the reader page for PDFs), at 1× with the session's voice,
  pacing, rules and pronunciations:
  1. Render every segment. 16-bit PCM goes to an OPFS scratch file (memory stays flat for long
     books) while BS.1770-4 loudness and true peak are metered.
  2. Dry-run a look-ahead limiter at the gain for the target, then add back what it took (at
     most +3 dB).
  3. Apply the gain and limit, then write MP3 (LAME via wasm-media-encoders, 64 kbps CBR mono, at
     the voice's sample rate) or WAV. Both carry an ID3v2.3 tag: title, artist, album, and a CTOC
     with one CHAP per heading. Text before the first heading becomes a chapter named after the
     document. Over 255 chapters, deeper heading levels are dropped first.
  4. The host hands over a blob URL of the OPFS file. The background (web) or the reader (PDF)
     saves it with `chrome.downloads`, then the host deletes the file and revokes the URL.
     Progress and Cancel go through the session (`exportJob`), so the side panel can be closed
     and reopened during an export.
- **Loudness targets**, measured with FFmpeg's `ebur128` on a Kokoro export of the blog fixture:
  - WAV: −17.0 LUFS, −1.5 dBTP, matching our meter.
  - 64 kbps MP3 measures 0.5 LU quieter than its source and overshoots peaks by about 1.1 dB. So
    MP3 aims at −16.5 LUFS before encoding with a ceiling of −3.0 dBFS, and decodes to −17.0 LUFS
    and −2.1 dBTP. (WAV uses a −2.0 dBFS ceiling.)
  - Chapters in MP3 move by LAME's 1,105-sample delay, so they line up with decoded audio.
- **System voices can't be exported** (chrome.tts produces no samples); the panel says so.
- **LAME is LGPL-2.0.** wasm-media-encoders is MIT, but its MP3 WASM is LAME. It ships as a
  separate file (`assets/mp3-*.wasm`) loaded at runtime, not inlined, so it can be replaced.

## Consequences

- A 67 s page renders and encodes in about 10 s with Kokoro on WebGPU (RTF ≈ 0.15 end to end).
- Exports always run at 1×. Playback speed is for listening; audiobook players have their own.
- Tests: chapter round-trip with music-metadata and ffprobe, exported duration equal to the
  playback plan (MP3 within LAME's delay plus one frame), loudness and peak, cancel, the sleep
  timer (unit and E2E), per-document rules, and the editor.
