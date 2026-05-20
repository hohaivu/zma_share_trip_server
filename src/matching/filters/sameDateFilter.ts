import { HardFilter } from '../ports'

export const sameDateFilter: HardFilter<{ departureWindowStartDate: string }, { departureWindowStartDate: string }> = {
  name: 'sameDateFilter',
  async passes(candidate, query, _ctx): Promise<boolean> {
    return candidate.departureWindowStartDate.slice(0, 10) === query.departureWindowStartDate.slice(0, 10)
  },
}
