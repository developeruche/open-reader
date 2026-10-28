/** "1.0×", "1.25×" */
export function formatRate(rate: number): string {
  return `${rate % 1 === 0 ? rate.toFixed(1) : String(+rate.toFixed(2))}×`;
}

/** "8 min left", "45 s left", "1 h 5 min left" */
export function formatTimeLeft(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s left`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min left`;
  return `${Math.floor(m / 60)} h ${m % 60} min left`;
}
