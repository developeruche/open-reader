"""Unit tests for the WER normalization (run: uv run --project quality python -m pytest -q quality)."""
from asr_qa import normalize, wer


def test_spelled_letters_join():
    assert normalize("A P S B T is signed") == ["a", "psbt", "is", "signed"]
    assert normalize("A PSBT is signed") == ["a", "psbt", "is", "signed"]
    assert normalize("the A P I") == ["the", "api"]
    assert normalize("U T X O's") == ["utxos"]


def test_numbers_and_aliases():
    assert normalize("one hundred forty two sats") == ["142", "sats"]
    assert normalize("a nonss") == ["a", "nonce"]
    assert normalize("1,692 sats") == ["1692", "sats"]


def test_wer():
    assert wer(["a", "b", "c"], ["a", "x", "c"]) == (1, 3)
    assert wer([], []) == (0, 1)


def test_ordinals_versions_and_compounds():
    assert normalize("the twenty-first of May") == normalize("the 21st of May")
    assert normalize("version 32.0") == ["version", "32"]
    assert normalize("tap root and air-gapped") == ["taproot", "and", "air", "gapped"]
