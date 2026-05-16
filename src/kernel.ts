import express, { Express } from 'express'

export interface Provider {
  name: string
  register(kernel: Kernel): void | Promise<void>
}

export class Kernel {
  readonly app: Express = express()
  private providers: Provider[] = []
  private pendingRegistrations: Array<void | Promise<void>> = []

  /**
   * Register a provider and invoke its `register` hook eagerly so that the
   * express app is fully configured the moment registration returns. The
   * returned value (which may be a promise for async providers) is tracked
   * so `boot()` can await it before declaring the kernel ready.
   */
  register(provider: Provider): this {
    this.providers.push(provider)
    this.pendingRegistrations.push(provider.register(this))
    return this
  }

  /**
   * Resolve all pending registrations. For synchronous providers this is
   * effectively a no-op; for async providers callers must `await boot()`
   * before treating the app as ready.
   */
  async boot(): Promise<void> {
    const pending = this.pendingRegistrations
    this.pendingRegistrations = []
    for (const result of pending) {
      await result
    }
  }

  /** Names of providers registered so far, in registration order. */
  registeredProviders(): readonly string[] {
    return this.providers.map(p => p.name)
  }
}

export const createKernel = (): Kernel => new Kernel()
