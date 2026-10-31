import { gameModeName, rankTier, summarizeGames } from 'eternal-return-api'

const MODE_LABEL = { normal: '일반', rank: '랭크', cobalt: '코발트', loneWolf: '론울프', unknown: '기타' }

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
    // Cobalt Protocol ranks teams, not players, so it would skew averages.
    summary: summarizeGames(games.filter((g) => gameModeName(g.matchingMode) !== 'cobalt')),
    names,
  }
}

const pct = (x) => `${Math.round(x * 100)}%`

/** Plain text lines, so the same output works in a Discord embed or a terminal. */
export function profileText({ user, season, rank, games, summary, names }) {
  const lines = []
  if (rank && rank.mmr > 0) {
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
    lines.push('', `최근 ${o.games}경기(코발트 제외): 평균 ${o.averageRank.toFixed(1)}위 · 승률 ${pct(o.winRate)} · TOP3 ${pct(o.top3Rate)} · 평균 ${o.averageKills.toFixed(1)}킬`)
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
