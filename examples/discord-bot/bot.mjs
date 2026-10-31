// Discord bot with one command: /er nickname
// Env: DISCORD_TOKEN, ER_API_KEY, optional GUILD_ID (registers the command in one server, instantly)
import { Client, EmbedBuilder, Events, GatewayIntentBits, SlashCommandBuilder } from 'discord.js'
import { ErClient, ErNicknameMismatchError, MemoryCache } from 'eternal-return-api'
import { loadProfile, profileText } from './profile.mjs'

// The cache lets repeated lookups skip the 1 request/second limit.
const er = new ErClient({ apiKey: process.env.ER_API_KEY, cache: new MemoryCache() })

const command = new SlashCommandBuilder()
  .setName('er')
  .setDescription('이터널 리턴 전적')
  .addStringOption((o) => o.setName('nickname').setDescription('닉네임').setRequired(true))

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set([command.toJSON()], process.env.GUILD_ID)
  console.log(`Ready as ${c.user.tag}`)
})

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'er') return
  // The API allows about one request per second, so answer later.
  await interaction.deferReply()
  const nickname = interaction.options.getString('nickname', true)
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
    const message = e instanceof ErNicknameMismatchError
      ? '닉네임을 정확히 입력해 주세요.'
      : '전적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    await interaction.editReply(message)
  }
})

client.login(process.env.DISCORD_TOKEN)
