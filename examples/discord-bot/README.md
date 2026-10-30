# Discord bot example

`/er nickname` shows a player's current ranked RP, a summary of recent games, most played characters and the last five games.

`/er 닉네임`으로 현재 랭크 RP, 최근 경기 요약, 많이 한 실험체, 최근 5경기를 보여 주는 디스코드 봇입니다.

```sh
cd examples/discord-bot
npm install
DISCORD_TOKEN=... ER_API_KEY=... GUILD_ID=... npm start
```

- `DISCORD_TOKEN`: bot token from the [Discord Developer Portal](https://discord.com/developers/applications). Invite the bot with the `bot` and `applications.commands` scopes.
- `ER_API_KEY`: key from [developer.eternalreturn.io](https://developer.eternalreturn.io).
- `GUILD_ID` (optional): registers the command in one server right away. Without it, the command is registered globally.

`profile.mjs` has no Discord code, so you can reuse it for other bots or a CLI.
