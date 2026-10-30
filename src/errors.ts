/**
 * Thrown for any failed Open API call.
 *
 * `status` is the HTTP status when the request failed at the HTTP level.
 * When HTTP says 200 but the body `code` is an error, `status` is that code.
 * `apiCode` is the body `code` whenever there was one. Timeouts use 504.
 */
export class ErApiError extends Error {
  readonly status: number
  readonly apiCode: number | undefined

  constructor(status: number, message: string, apiCode?: number) {
    super(message)
    this.name = 'ErApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

/**
 * The nickname lookup returned a different player than the one asked for.
 * The comparison already ignores case and full-width/half-width differences.
 */
export class ErNicknameMismatchError extends ErApiError {
  readonly requested: string
  readonly returned: string

  constructor(requested: string, returned: string) {
    super(409, `Nickname lookup mismatch: requested=${requested}, returned=${returned}`)
    this.name = 'ErNicknameMismatchError'
    this.requested = requested
    this.returned = returned
  }
}
