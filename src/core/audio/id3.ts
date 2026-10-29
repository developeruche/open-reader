/**
 * Minimal ID3v2.3 writer for audiobook export (PLAN.md M11): title and artist text frames, and one
 * CHAP frame per chapter under an ordered top-level CTOC (ID3v2 Chapter Frame Addendum 1.0).
 */
export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
}

export interface Id3Tags {
  title: string;
  artist?: string;
  album?: string;
  chapters?: Chapter[];
}

/** CTOC stores its child count in one byte. */
export const MAX_CHAPTERS = 255;

const latin1 = (s: string) =>
  Uint8Array.from([...s].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 0x3f)));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u32 = (n: number) =>
  Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** ID3v2.3 frame: 4-char id, 32-bit big-endian size (not syncsafe in 2.3), two flag bytes. */
function frame(id: string, body: Uint8Array): Uint8Array {
  return concat([latin1(id), u32(body.length), Uint8Array.of(0, 0), body]);
}

/** Text frame in UTF-16 with BOM (encoding 1), so any title survives. */
function textFrame(id: string, text: string): Uint8Array {
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16[0] = 0xff;
  utf16[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    utf16[2 + i * 2] = c & 255;
    utf16[3 + i * 2] = c >> 8;
  }
  return frame(id, concat([Uint8Array.of(1), utf16, Uint8Array.of(0, 0)]));
}

const cstr = (s: string) => concat([latin1(s), Uint8Array.of(0)]);

export function id3v23(tags: Id3Tags): Uint8Array {
  const frames: Uint8Array[] = [textFrame('TIT2', tags.title)];
  if (tags.artist) frames.push(textFrame('TPE1', tags.artist));
  if (tags.album) frames.push(textFrame('TALB', tags.album));
  const chapters = (tags.chapters ?? []).slice(0, MAX_CHAPTERS);
  if (chapters.length) {
    const ids = chapters.map((_, i) => `ch${i}`);
    frames.push(
      frame(
        'CTOC',
        concat([
          cstr('toc'),
          Uint8Array.of(0x03), // top-level, ordered
          Uint8Array.of(chapters.length),
          ...ids.map(cstr),
          textFrame('TIT2', 'Chapters'),
        ]),
      ),
    );
    chapters.forEach((c, i) =>
      frames.push(
        frame(
          'CHAP',
          concat([
            cstr(ids[i] ?? `ch${i}`),
            u32(Math.round(c.startMs)),
            u32(Math.round(c.endMs)),
            u32(0xffffffff), // no byte offsets
            u32(0xffffffff),
            textFrame('TIT2', c.title),
          ]),
        ),
      ),
    );
  }
  const body = concat(frames);
  const size = body.length;
  // Tag size is syncsafe: 7 bits per byte.
  const header = Uint8Array.of(
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    (size >> 21) & 127,
    (size >> 14) & 127,
    (size >> 7) & 127,
    size & 127,
  );
  return concat([header, body]);
}
