"""ASR quality harness (PLAN.md §11): transcribe rendered segments and compute WER.

Usage:
  uv run --project quality python quality/asr_qa.py quality/out/<run> [--update-baseline]

Reads <run>/manifest.json written by scripts/synth-corpus.ts:
  [{"id", "engine", "voice", "spoken", "wav", ...}]
Writes <run>/asr.json and prints WER per voice plus the worst segments. Exits non-zero when
overall WER > 8% or a voice regresses by more than 1 point against quality/baseline.json.
"""

from __future__ import annotations

import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

GATE_WER = 0.08
GATE_REGRESSION = 0.01
BASELINE = Path(__file__).with_name("baseline.json")

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
ORD = {"first": 1, "second": 2, "third": 3, "fifth": 5, "eighth": 8, "ninth": 9, "twelfth": 12}
MULTI = {"tap root": "taproot", "seg wit": "segwit", "mem pool": "mempool", "multi sig": "multisig", "sig hash": "sighash", "mew sig": "musig", "git hub": "github", "web assembly": "webassembly"}
# Known respellings and ASR-equivalent spellings.
ALIASES = {
    "nonss": "nonce", "yammel": "yaml", "tommel": "toml", "jason": "json", "shnor": "schnorr",
    "reepo": "repo", "gooey": "gui", "sats": "sats", "okay": "ok", "versus": "vs",
    "taproot": "taproot", "tap": "tap", "segwit": "segwit", "bitcoins": "bitcoin",
}


def words_to_numbers(tokens: list[str]) -> list[str]:
    """Collapses runs like 'one hundred forty two' into '142'."""
    out: list[str] = []
    i = 0
    while i < len(tokens):
        total, current, used = 0, 0, False
        j = i
        while j < len(tokens):
            t = tokens[j].replace("-", " ").split()
            ok = True
            for w in t:
                if w in ONES:
                    current += ONES.index(w)
                elif w in TENS[2:]:
                    current += TENS.index(w) * 10
                elif w == "hundred" and used:
                    current *= 100
                elif w in ("thousand", "million") and used:
                    total += current * (1000 if w == "thousand" else 1_000_000)
                    current = 0
                elif w == "and" and used:
                    pass
                else:
                    ok = False
                    break
                used = True
            if not ok:
                break
            j += 1
        if used and j > i:
            out.append(str(total + current))
            i = j
        else:
            out.append(tokens[i])
            i += 1
    return out


def ordinal_words(t: str) -> str:
    """'twenty-first' -> '21st' style digits, so both spellings compare equal."""
    def word_value(w: str) -> int | None:
        if w in ORD:
            return ORD[w]
        if w.endswith("ieth") and w[:-4] + "y" in TENS:
            return TENS.index(w[:-4] + "y") * 10
        if w.endswith("th") and w[:-2] in ONES:
            return ONES.index(w[:-2])
        return None
    def repl(m: re.Match[str]) -> str:
        tens, unit = m.group(1), m.group(2)
        v = word_value(unit)
        if v is None:
            return m.group(0)
        return str((TENS.index(tens) * 10 if tens else 0) + v)
    tens_alt = "|".join(TENS[2:])
    return re.sub(rf"\b(?:({tens_alt})[- ])?([a-z]+(?:th|st|nd|rd))\b", repl, t)


def normalize(text: str) -> list[str]:
    t = text.lower()
    t = re.sub(r"\b(\d+)(?:st|nd|rd|th)\b", r"\1", t)
    t = ordinal_words(t)
    t = re.sub(r"\b(\d+)\.0\b", r"\1", t)
    t = t.replace("-", " ")
    for a, b in MULTI.items():
        t = re.sub(rf"\b{a}\b", b, t)
    t = t.replace("%", " percent").replace("&", " and ")
    t = re.sub(r"(\d),(\d)", r"\1\2", t)
    # A single letter's plural ("O's" in "U T X O's") becomes a marker joined to the letter run.
    t = re.sub(r"\b([a-z])'s\b", r"\1 _s", t)
    t = re.sub(r"[^a-z0-9'_ -]+", " ", t)
    t = t.replace("'s", "s").replace("'", "")
    tokens = [ALIASES.get(w, w) for w in t.split()]
    # Join spelled letters: "p s b t" -> "psbt", "u t x os" -> "utxos".
    joined: list[str] = []
    run: list[str] = []
    for w in tokens + [""]:
        if len(w) == 1 and w.isalpha():
            run.append(w)
            continue
        if w == "_s":
            if run:
                run.append("s")
            continue
        if len(run) >= 4 and run[0] in ("a", "i"):
            # "a p s b t" is the article plus a spelled acronym, as ASR hears it.
            joined.append(run[0])
            run = run[1:]
        if len(run) >= 2:
            joined.append("".join(run))
        else:
            joined.extend(run)
        run = []
        if w:
            joined.append(w)
    tokens = words_to_numbers(joined)
    return [ALIASES.get(w, w) for w in tokens]


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    """Edit distance and reference length."""
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)], max(1, len(ref))


def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(len(x) * 16000 / sr)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def main() -> int:
    run = Path(sys.argv[1])
    update = "--update-baseline" in sys.argv
    from faster_whisper import WhisperModel

    model_name = "small.en"
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
    except Exception:  # noqa: BLE001 - fall back to the smaller model
        model_name = "base.en"
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
    manifest = json.loads((run / "manifest.json").read_text())
    rows = []
    for item in manifest:
        segs, _ = model.transcribe(load_wav(run / item["wav"]), beam_size=5, language="en")
        hyp = " ".join(s.text.strip() for s in segs)
        errs, n = wer(normalize(item["spoken"]), normalize(hyp))
        rows.append({**item, "transcript": hyp, "errors": errs, "words": n, "wer": errs / n})
    by_voice: dict[str, dict[str, float]] = {}
    for r in rows:
        key = f"{r['engine']}:{r['voice']}"
        v = by_voice.setdefault(key, {"errors": 0, "words": 0})
        v["errors"] += r["errors"]
        v["words"] += r["words"]
    summary = {k: round(v["errors"] / v["words"], 4) for k, v in by_voice.items()}
    total = sum(r["errors"] for r in rows) / max(1, sum(r["words"] for r in rows))
    (run / "asr.json").write_text(json.dumps({"model": model_name, "overall": total, "voices": summary, "rows": rows}, indent=2))
    print(f"ASR model: {model_name}")
    for k, v in sorted(summary.items()):
        print(f"  {k:45s} WER {v * 100:5.1f}%")
    print(f"  overall                                       WER {total * 100:5.1f}%")
    print("Worst segments:")
    for r in sorted(rows, key=lambda r: r["wer"], reverse=True)[:5]:
        print(f"  {r['wer'] * 100:5.1f}%  {r['engine']}:{r['voice']}  {r['id']}\n         said:  {r['spoken']}\n         heard: {r['transcript']}")
    failed = total > GATE_WER
    if BASELINE.exists() and not update:
        base = json.loads(BASELINE.read_text())["voices"]
        for k, v in summary.items():
            if k in base and v - base[k] > GATE_REGRESSION:
                print(f"REGRESSION {k}: {base[k] * 100:.1f}% -> {v * 100:.1f}%")
                failed = True
    if update:
        BASELINE.write_text(json.dumps({"model": model_name, "voices": summary}, indent=2) + "\n")
        print(f"Baseline written to {BASELINE}")
    if failed:
        print(f"FAILED: overall WER gate is {GATE_WER * 100:.0f}% and regressions over {GATE_REGRESSION * 100:.0f} point fail")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
