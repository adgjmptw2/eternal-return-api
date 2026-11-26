// Discord bot with two commands:
//   /er nickname          a player's rank and recent games
//   /er-watch nickname    post that player's results in this channel as they finish games
// Env: DISCORD_TOKEN, ER_API_KEY, optional GUILD_ID (registers the commands in one server, instantly)
import { Client, EmbedBuilder, Events, GatewayIntentBits, SlashCommandBuilder } from 'discord.js'
import { ErClient, ErNicknameMismatchError, MemoryCache } from 'eternal-return-api'
import { gameText, loadProfile, profileText } from './profile.mjs'

// The cache lets repeated lookups skip the 1 request/second limit.
const er = new ErClient({ apiKey: process.env.ER_API_KEY, cache: new MemoryCache() })

const commands = [
  new SlashCommandBuilder()
    .setName('er')
    .setDescription('이터널 리턴 전적')
    .addStringOption((o) => o.setName('nickname').setDescription('닉네임').setRequired(true)),
  new SlashCommandBuilder()
    .setName('er-watch')
    .setDescription('이 채널에 경기 결과 알림 켜기/끄기')
    .addStringOption((o) => o.setName('nickname').setDescription('닉네임').setRequired(true)),
]

// nickname -> { uid, nickname, channels: Map(channelId -> newest gameId when turned on) }.
// Keyed by nickname: every lookup gives a player a different uid. In memory: a restart forgets it.
const watched = new Map()
// The same comparison the client uses to check the nickname a lookup returns.
const keyOf = (nickname) => nickname.normalize('NFKC').trim().toLowerCase()
// uid -> newest game when the first channel turned it on, read by watchGames.
const startAfter = new Map()

// Runs toggles for one player one at a time, so two channels cannot overwrite each other.
const toggling = new Map()
function oneAtATime(key, task) {
  const run = (toggling.get(key) ?? Promise.resolve()).then(task, task)
  const tail = run.catch(() => {})
  toggling.set(key, tail)
  tail.then(() => toggling.get(key) === tail && toggling.delete(key))
  return run
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set(commands.map((command) => command.toJSON()), process.env.GUILD_ID)
  console.log(`Ready as ${c.user.tag}`)
  postResults(c).catch((e) => console.error('watch stopped', e))
})

async function postResults(c) {
  const uids = () => [...watched.values()].map((entry) => entry.uid)
  for await (const event of er.watchGames({ uids, after: startAfter, intervalMs: 60_000 })) {
    if (event.type === 'error') {
      console.error('watch', event.uid, event.error)
      continue
    }
    const entry = [...watched.values()].find((e) => e.uid === event.uid)
    if (!entry) continue
    // Loaded once and kept; if it fails, the post shows codes and the next one tries again.
    const names = await er.getNames('Korean').catch(() => null)
    const embed = new EmbedBuilder().setTitle(`${entry.nickname} 경기 종료`).setDescription(gameText(event.game, names))
    for (const [channelId, since] of entry.channels) {
      // Only games finished after this channel turned the watch on.
      if (event.game.gameId <= since) continue
      const channel = await c.channels.fetch(channelId).catch(() => null)
      await channel?.send({ embeds: [embed] }).catch((e) => console.error('send', channelId, e))
    }
  }
}

function errorMessage(e) {
  return e instanceof ErNicknameMismatchError
    ? '닉네임을 정확히 입력해 주세요.'
    : '전적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  const nickname = interaction.options.getString('nickname', true)

  if (interaction.commandName === 'er-watch') {
    await interaction.deferReply()
    try {
      const key = keyOf(nickname)
      const result = await oneAtATime(key, async () => {
        const entry = watched.get(key)
        // Turning off needs no lookup, so it works during maintenance and after a rename.
        if (entry?.channels.delete(interaction.channelId)) {
          if (entry.channels.size === 0) {
            watched.delete(key)
            startAfter.delete(entry.uid)
          }
          return { on: false, name: entry.nickname }
        }
        const user = await er.getUserByNickname(nickname)
        if (!user) return null
        // Skip the cache: the start must be the game that is newest right now.
        const { games } = await er.getUserGames(user.uid, undefined, { fresh: true })
        const newest = games[0]?.gameId ?? 0
        if (entry) entry.channels.set(interaction.channelId, newest)
        else {
          startAfter.set(user.uid, newest)
          watched.set(key, { uid: user.uid, nickname: user.nickname, channels: new Map([[interaction.channelId, newest]]) })
        }
        return { on: true, name: user.nickname }
      })
      if (!result) {
        await interaction.editReply(`'${nickname}' 플레이어를 찾지 못했습니다.`)
        return
      }
      await interaction.editReply(
        result.on
          ? `${result.name}의 다음 경기부터 이 채널에 결과를 올립니다. 다시 입력하면 알림이 꺼집니다.`
          : `${result.name} 알림을 껐습니다.`,
      )
    } catch (e) {
      console.error(e)
      await interaction.editReply(errorMessage(e))
    }
    return
  }

  if (interaction.commandName !== 'er') return
  // The API allows about one request per second, so answer later.
  await interaction.deferReply()
  try {
    const profile = await loadProfile(er, nickname)
    if (!profile) {
      await interaction.editReply(`'${nickname}' 플레이어를 찾지 못했습니다.`)
      return
    }
    const { title, lines } = profileText(profile)
    const embed = new EmbedBuilder().setTitle(title).setDescription(lines.join('\n'))
    await interaction.editReply({ embeds: [embed] })
  } catch (e) {
    console.error(e)
    await interaction.editReply(errorMessage(e))
  }
})

client.login(process.env.DISCORD_TOKEN)
