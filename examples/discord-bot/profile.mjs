import { gameModeName, rankTier, rpChange, summarizeGames } from 'eternal-return-api'

const MODE_LABEL = { normal: '일반', rank: '랭크', cobalt: '코발트', loneWolf: '론울프', rumbleOut: '럼블 아웃', unknown: '기타' }
const SQUAD_MODES = ['normal', 'rank']

/** Loads what the /er command shows. Returns null when the player does not exist. */
export async function loadProfile(er, nickname, { language = 'Korean', pages = 2 } = {}) {
  const user = await er.getUserByNickname(nickname)
  if (!user) return null
  const names = await er.getNames(language)
  const seasons = await er.getSeasons()
  const seasonId = seasons.currentRankedSeasonId
  const rank = seasonId ? await er.getUserRank(user.uid, seasonId) : null
  const games = []
  for await (const game of er.iterateUserGames(user.uid, { maxPages: pages })) games.push(game)
  return {
    user,
    season: seasonId ? seasons.playerSeasonOf(seasonId) : null,
    rank,
    games,
    // Other modes have fewer teams, so their ranks would skew the averages.
    summary: summarizeGames(games.filter((g) => SQUAD_MODES.includes(gameModeName(g.matchingMode)))),
    names,
  }
}

const pct = (x) => `${Math.round(x * 100)}%`

/** Plain text lines, so the same output works in a Discord embed or a terminal. */
export function profileText({ user, season, rank, games, summary, names }) {
  const lines = []
  if (rank) {
    const tier = rankTier(rank.mmr, { rank: rank.rank, season })
    const localName = names.tier(tier.tier)
    const tierName = !localName ? tier.name : tier.division === null ? localName : `${localName} ${tier.division}`
    lines.push(`시즌 ${season} 스쿼드 랭크: ${tierName} · ${rank.mmr.toLocaleString()} RP · ${rank.rank.toLocaleString()}위`)
  } else {
    lines.push(`시즌 ${season ?? '?'} 스쿼드 랭크 기록 없음`)
  }
  if (games.length === 0) return { title: user.nickname, lines: [...lines, '최근 90일 경기 없음'] }

  const o = summary.overall
  if (o.games > 0) {
    lines.push('', `최근 일반·랭크 ${o.games}경기: 평균 ${o.averageRank.toFixed(1)}위 · 승률 ${pct(o.winRate)} · TOP3 ${pct(o.top3Rate)} · 평균 ${o.averageKills.toFixed(1)}킬`)
    lines.push('', '많이 한 실험체')
    for (const c of summary.characters.slice(0, 3)) {
      lines.push(`${names.character(c.characterNum) ?? c.characterNum} ${c.games}판 · 평균 ${c.averageRank.toFixed(1)}위 · ${c.averageKills.toFixed(1)}킬`)
    }
  }
  lines.push('', '최근 경기')
  for (const g of games.slice(0, 5)) {
    const parts = [
      MODE_LABEL[gameModeName(g.matchingMode)],
      `${names.character(g.characterNum) ?? g.characterNum}(${names.weapon(g.bestWeapon) ?? '?'})`,
      `${g.gameRank}위`,
      `${g.playerKill}킬`,
      names.tacticalSkill(g.tacticalSkillGroup),
    ]
    lines.push(parts.filter(Boolean).join(' · '))
  }
  return { title: user.nickname, lines }
}

const NO_NAMES = { character: () => null, weapon: () => null }

/** One finished game, for the /er-watch posts. `names` may be null. */
export function gameText(g, names) {
  names ??= NO_NAMES
  const mode = gameModeName(g.matchingMode)
  const parts = [
    MODE_LABEL[mode],
    `${names.character(g.characterNum) ?? g.characterNum}(${names.weapon(g.bestWeapon) ?? '?'})`,
    `${g.gameRank}위`,
    `${g.playerKill}킬 ${g.playerAssistant}어시`,
  ]
  if (typeof g.damageToPlayer === 'number') parts.push(`딜량 ${g.damageToPlayer.toLocaleString()}`)
  const rp = rpChange(g)
  if (rp) parts.push(`RP ${rp.change >= 0 ? '+' : ''}${rp.change} → ${rp.after.toLocaleString()}`)
  return parts.join(' · ')
}
