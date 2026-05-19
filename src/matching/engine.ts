import { CandidateSource, FilterContext, HardFilter } from './ports'

export interface EngineConfig<Q, C, R> {
  source: CandidateSource<Q, C>
  filters: HardFilter<Q, C>[]
  score: (candidate: C, query: Q, ctx: FilterContext) => R
  rank: (results: R[]) => R[]
  buildContext: (query: Q) => FilterContext
}

export class MatchEngine<Q, C, R> {
  constructor(private readonly config: EngineConfig<Q, C, R>) {}

  async run(query: Q): Promise<R[]> {
    const { source, filters, score, rank, buildContext } = this.config
    const ctx = buildContext(query)
    const candidates = await source.list(query, ctx)
    const results: R[] = []

    for (const candidate of candidates) {
      let passed = true
      for (const filter of filters) {
        if (!(await filter.passes(candidate, query, ctx))) {
          passed = false
          break
        }
      }
      if (passed) results.push(score(candidate, query, ctx))
    }

    return rank(results)
  }
}
