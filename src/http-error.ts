export class HttpError<T = unknown> extends Error {
  public readonly exposeDetails: boolean

  constructor(
    public statusCode: number,
    message: string,
    public payload?: T,
    options?: { exposeDetails?: boolean },
  ) {
    super(message)
    this.exposeDetails = options?.exposeDetails === true
  }

  static withSafeDetails<T>(
    statusCode: number,
    message: string,
    payload: T,
  ): HttpError<T> {
    return new HttpError(statusCode, message, payload, { exposeDetails: true })
  }
}
