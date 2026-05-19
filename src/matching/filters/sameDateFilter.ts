import { HardFilter } from '../ports'

export const sameDateFilter: HardFilter<{ departureDate: string }, { departureDate: string }> = {
  name: 'sameDateFilter',
  async passes(candidate, query, _ctx): Promise<boolean> {
    return candidate.departureDate.slice(0, 10) === query.departureDate.slice(0, 10)
  },
}
