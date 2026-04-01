export class HttpError<T = unknown> extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public payload?: T,
  ) {
    super(message)
  }
}
