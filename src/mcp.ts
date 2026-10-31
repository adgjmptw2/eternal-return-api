#!/usr/bin/env node
/**
 * MCP server over stdio, so AI assistants can look up Eternal Return records.
 *
 * Env: ER_API_KEY (required), ER_LANGUAGE (l10n language for names, default Korean).
 * Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout; logs go to stderr.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { MemoryCache } from './cache.js'
import { ErClient } from './client.js'
import { ErApiError, ErNicknameMismatchError } from './errors.js'
import { MatchingMode, TeamMode, gameModeName } from './modes.js'
import type { GameNames } from './names.js'
import { summarizeGames, type GameSummary } from './summary.js'
import { groupTeams } from './teams.js'
import type { UserGame } from './types.js'

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
const LANGUAGE = process.env.ER_LANGUAGE || 'Korean'

type Json = Record<string, unknown>

class ToolInputError extends Error {}

const TOOLS = [
  {
    name: 'player_profile',
    description:
      'Eternal Return player: current squad ranked RP and rank, a summary of recent games (Cobalt Protocol excluded, last 90 days at most), most played characters, and the recent games with character, weapon, tactical skill, traits and items as names.',
    inputSchema: {
      type: 'object',
      properties: {
        nickname: { type: 'string', description: 'In-game nickname' },
        games: { type: 'integer', minimum: 1, maximum: 50, description: 'How many recent games to read (default 20)' },
      },
      required: ['nickname'],
    },
  },
  {
    name: 'game_detail',
    description: 'One Eternal Return game by team, best placement first: team kills and every player with character, weapon, kills, assists, damage.',
    inputSchema: {
      type: 'object',
      properties: { gameId: { type: 'integer', description: 'Game ID from player_profile' } },
      required: ['gameId'],
    },
  },
  {
    name: 'top_ranks',
    description: 'Top ranked Eternal Return players of the current ranked season, with RP.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many players (default 20)' },
      },
    },
  },
]

function intArg(args: Json, key: string, fallback: number | null, min: number, max: number): number {
  const value = args[key] === undefined ? fallback : args[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolInputError(`${key} must be an integer from ${min} to ${max}`)
  }
  return value
}

const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits

function summaryJson(s: GameSummary): Json {
  return {
    games: s.games,
    wins: s.wins,
    top3: s.top3,
    winRate: round(s.winRate),
    top3Rate: round(s.top3Rate),
    averageRank: round(s.averageRank),
    averageKills: round(s.averageKills),
    averageAssists: round(s.averageAssists),
    averageDamage: s.averageDamage === null ? null : Math.round(s.averageDamage),
  }
}

function equipmentCodes(game: UserGame): number[] {
  const equipment = game.equipment
  if (!equipment) return []
  return (Array.isArray(equipment) ? equipment : Object.values(equipment)).filter((code) => code > 0)
}

function gameJson(game: UserGame, names: GameNames): Json {
  const traits = [game.traitFirstCore, ...(game.traitFirstSub ?? []), ...(game.traitSecondSub ?? [])]
  return {
    gameId: game.gameId,
    startDtm: game.startDtm,
    mode: gameModeName(game.matchingMode),
    character: names.character(game.characterNum) ?? game.characterNum,
    weapon: names.weapon(game.bestWeapon),
    rank: game.gameRank,
    kills: game.playerKill,
    assists: game.playerAssistant,
    damageToPlayer: game.damageToPlayer ?? null,
    // mmrGain is the RP change in ranked games only.
    rpGain: game.matchingMode === MatchingMode.RANKED ? game.mmrGain ?? null : null,
    tacticalSkill: names.tacticalSkill(game.tacticalSkillGroup),
    traits: traits.filter((code): code is number => typeof code === 'number' && code > 0).map((code) => names.trait(code) ?? code),
    items: equipmentCodes(game).map((code) => names.item(code) ?? code),
  }
}

async function playerProfile(er: ErClient, args: Json): Promise<Json> {
  const nickname = typeof args.nickname === 'string' ? args.nickname.trim() : ''
  if (!nickname) throw new ToolInputError('nickname is required')
  const count = intArg(args, 'games', 20, 1, 50)

  const user = await er.getUserByNickname(nickname)
  if (!user) return { found: false, nickname }
  const names = await er.getNames(LANGUAGE)
  const seasons = await er.getSeasons()
  const seasonId = seasons.currentRankedSeasonId
  const rank = seasonId === null ? null : await er.getUserRank(user.uid, seasonId)

  const games: UserGame[] = []
  for await (const game of er.iterateUserGames(user.uid, { maxPages: Math.ceil(count / 10) + 1 })) {
    games.push(game)
    if (games.length >= count) break
  }
  // Cobalt Protocol ranks teams, not players, so it is left out of the averages.
  const summary = summarizeGames(games.filter((game) => gameModeName(game.matchingMode) !== 'cobalt'))
  return {
    found: true,
    nickname: user.nickname,
    season: seasonId === null ? null : seasons.playerSeasonOf(seasonId),
    squadRank: rank && rank.mmr > 0 ? { rp: rank.mmr, rank: rank.rank } : null,
    recent: summaryJson(summary.overall),
    characters: summary.characters.slice(0, 5).map((c) => ({
      character: names.character(c.characterNum) ?? c.characterNum,
      ...summaryJson(c),
    })),
    games: games.map((game) => gameJson(game, names)),
  }
}

async function gameDetail(er: ErClient, args: Json): Promise<Json> {
  const gameId = intArg(args, 'gameId', null, 1, Number.MAX_SAFE_INTEGER)
  const players = await er.getGame(gameId)
  if (players.length === 0) return { found: false, gameId }
  const names = await er.getNames(LANGUAGE)
  const first = players[0]!
  return {
    found: true,
    gameId,
    startDtm: first.startDtm,
    mode: gameModeName(first.matchingMode),
    teams: groupTeams(players).map((team) => ({
      team: team.teamNumber,
      rank: team.gameRank,
      victory: team.victory,
      teamKills: team.teamKills,
      players: team.players.map((p) => ({
        nickname: p.nickname ?? null,
        character: names.character(p.characterNum) ?? p.characterNum,
        weapon: names.weapon(p.bestWeapon),
        kills: p.playerKill,
        assists: p.playerAssistant,
        damageToPlayer: p.damageToPlayer ?? null,
      })),
    })),
  }
}

async function topRanks(er: ErClient, args: Json): Promise<Json> {
  const limit = intArg(args, 'limit', 20, 1, 100)
  const seasons = await er.getSeasons()
  const seasonId = seasons.currentRankedSeasonId
  if (seasonId === null) return { season: null, players: [] }
  const top = await er.getTopRanks(seasonId, TeamMode.SQUAD)
  return {
    season: seasons.playerSeasonOf(seasonId),
    players: top.slice(0, limit).map((p) => ({ rank: p.rank, nickname: p.nickname, rp: p.mmr })),
  }
}

const HANDLERS = new Map<string, (er: ErClient, args: Json) => Promise<Json>>([
  ['player_profile', playerProfile],
  ['game_detail', gameDetail],
  ['top_ranks', topRanks],
])

function toolErrorText(e: unknown): string {
  if (e instanceof ToolInputError) return e.message
  if (e instanceof ErNicknameMismatchError) return 'The API returned a different player. Check the exact nickname.'
  if (e instanceof ErApiError) return `Eternal Return API error ${e.status}: ${e.message}`
  return 'Unexpected error. See the server log.'
}

function send(message: Json): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Id = string | number

const isId = (value: unknown): value is Id =>
  typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))

async function handleRequest(er: ErClient, id: Id, method: string, params: Json): Promise<void> {
  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion
      const protocolVersion =
        typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0]
      send({
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'eternal-return-api', version: VERSION },
        },
      })
      return
    }
    case 'ping':
      send({ id, result: {} })
      return
    case 'tools/list':
      send({ id, result: { tools: TOOLS } })
      return
    case 'tools/call': {
      const handler = typeof params.name === 'string' ? HANDLERS.get(params.name) : undefined
      if (!handler) {
        const name = typeof params.name === 'string' ? params.name : '(missing)'
        send({ id, error: { code: -32602, message: `Unknown tool: ${name}` } })
        return
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        send({ id, error: { code: -32602, message: 'arguments must be an object' } })
        return
      }
      try {
        const result = await handler(er, (params.arguments as Json | undefined) ?? {})
        send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } })
      } catch (e) {
        if (!(e instanceof ToolInputError)) console.error(e)
        send({ id, result: { content: [{ type: 'text', text: toolErrorText(e) }], isError: true } })
      }
      return
    }
    default:
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

function handleMessage(er: ErClient, message: unknown): void {
  if (!isObject(message) || message.jsonrpc !== '2.0') {
    send({ id: null, error: { code: -32600, message: 'Invalid request' } })
    return
  }
  const { id, method } = message
  // Responses to requests we never send: ignore.
  if (method === undefined && ('result' in message || 'error' in message)) return
  if (typeof method !== 'string' || (id !== undefined && !isId(id))) {
    send({ id: isId(id) ? id : null, error: { code: -32600, message: 'Invalid request' } })
    return
  }
  if (message.params !== undefined && !isObject(message.params)) {
    if (id !== undefined) send({ id, error: { code: -32602, message: 'params must be an object' } })
    return
  }
  if (id === undefined) return // notification, e.g. notifications/initialized
  handleRequest(er, id, method, (message.params as Json | undefined) ?? {}).catch((e) => {
    console.error(e)
    send({ id, error: { code: -32603, message: 'Internal error' } })
  })
}

function main(): void {
  const apiKey = process.env.ER_API_KEY
  if (!apiKey) {
    console.error('ER_API_KEY is not set')
    process.exit(1)
  }
  const er = new ErClient({ apiKey, cache: new MemoryCache({ maxEntries: 500 }) })
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    if (!line.trim()) return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    handleMessage(er, message)
  })
}

main()
