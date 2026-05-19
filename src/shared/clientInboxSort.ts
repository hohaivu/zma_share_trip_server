import type { ClientRequestItem } from '../types/payloads'

// Sort comparator: newest createdAt first.
// Mirrors FE mergeAndSortClientRequests in src/utils/offer.ts:182
export function sortClientInboxItems(items: ClientRequestItem[]): ClientRequestItem[] {
  return items.slice().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}
