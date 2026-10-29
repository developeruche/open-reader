/**
 * Deterministic 200-sentence corpus for timing-estimation and WER checks (§5.4.4, §11).
 * Grammatical template sentences with domain vocabulary; no third-party text.
 */
export function corpus(n = 200, seed = 7): string[] {
  const subjects = [
    'The creator',
    'Each signer',
    'The updater',
    'A hardware wallet',
    'The finalizer',
    'Every node',
    'The reader',
    'A careful user',
    'The miner',
    'Our test suite',
  ];
  const verbs = [
    'checks',
    'records',
    'verifies',
    'signs',
    'combines',
    'reads',
    'publishes',
    'compares',
    'stores',
    'rejects',
  ];
  const objects = [
    'the partial signature',
    'every previous output',
    'the derivation path',
    'the full transaction',
    'a fee of twelve sats',
    'the change address',
    'the witness data',
    'a short paragraph',
    'the block header',
    'the spending policy',
  ];
  const tails = [
    'before broadcasting it.',
    'after the update arrives.',
    'without asking for private keys.',
    'so that nobody has to trust anybody.',
    'when the network is quiet.',
    'on a computer that is offline.',
    'in less than a second.',
    'and then waits for confirmation.',
    'while the voice keeps reading.',
    'because the rules require it.',
  ];
  const extras = [
    '',
    '',
    '',
    ' Then it moves on to the next step.',
    ' This takes a moment.',
    ' Nothing else changes.',
  ];
  let x = seed;
  const rand = (k: number) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % k;
  };
  const out = new Set<string>();
  while (out.size < n) {
    const s = `${subjects[rand(subjects.length)]} ${verbs[rand(verbs.length)]} ${objects[rand(objects.length)]} ${tails[rand(tails.length)]}${extras[rand(extras.length)]}`;
    out.add(s);
  }
  return [...out];
}
