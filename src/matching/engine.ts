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
    const ctx = this.config.buildContext(query)
    const candidates = await this.config.source.list(query, ctx)
    const results: R[] = []

    for (const candidate of candidates) {
      let passed = true
      for (const filter of this.config.filters) {
        if (!(await filter.passes(candidate, query, ctx))) {
          passed = false
          break
        }
      }
      if (!passed) continue

      results.push(this.config.score(candidate, query, ctx))
    }

    return this.config.rank(results)
  }
}
