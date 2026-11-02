/**
 * Sample responses for building and testing without an API key.
 *
 * Made-up responses in the shape of the real API: two ranked games with
 * every player, the leaderboard, the season, tactical skill, character
 * mastery and item tables, and the localization keys those games need
 * (Korean and English). Nothing comes from the API: names, codes and numbers
 * are invented. Field names and the relations between fields follow the real
 * API. The sample player is `Player1`. Node only: it reads a file bundled
 * with the package.
 *
 * ```ts
 * import { createSampleClient, SAMPLE_NICKNAME } from 'eternal-return-api/testing'
 *
 * const er = createSampleClient()
 * const user = await er.getUserByNickname(SAMPLE_NICKNAME)
 * ```
 *
 * @module testing
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { ErClient, type ErClientOptions } from './client.js'

interface SampleData {
  seasonId: number
  uid: string
  bodies: Record<string, unknown>
  files: Record<string, string>
}

/** The primary sample player. */
export const SAMPLE_NICKNAME = 'Player1'

let data: SampleData | undefined

function load(): SampleData {
  data ??= JSON.parse(
    gunzipSync(readFileSync(new URL('../samples/sample.json.gz', import.meta.url))).toString('utf8'),
  ) as SampleData
  return data
}

const NOT_FOUND = { code: 404, message: 'Not Found' }

/**
 * A `fetch` that answers from the sample data. Anything not in it gets what
 * the real API sends for a missing record: HTTP 200 with `code: 404`.
 */
export function sampleFetch(): typeof fetch {
  const sample = load()
  return async (input) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    if (url.protocol === 'sample:') {
      const language = url.pathname.replace(/^l10n\//, '')
      const text = sample.files[language]
      return new Response(text ?? '', { status: text === undefined ? 404 : 200 })
    }
    const body = sample.bodies[url.pathname + url.search] ?? NOT_FOUND
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

/** An `ErClient` backed by the sample data, with no rate limit. */
export function createSampleClient(options: Partial<ErClientOptions> = {}): ErClient {
  return new ErClient({
    apiKey: 'sample',
    requestsPerSecond: 1000,
    burst: 1000,
    ...options,
    fetch: sampleFetch(),
  })
}
