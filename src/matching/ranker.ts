export function sortByTierThenScore<T extends { matchTier: string; matchScore: number }>(
  results: T[],
): T[] {
  return [...results].sort((a, b) => {
    if (a.matchTier === 'exact_3' && b.matchTier !== 'exact_3') return -1
    if (a.matchTier !== 'exact_3' && b.matchTier === 'exact_3') return 1
    return b.matchScore - a.matchScore
  })
}
