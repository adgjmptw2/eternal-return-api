# Discord bot example

- `/er nickname` shows a player's current ranked RP, a summary of recent games, most played characters and the last five games.
- `/er-watch nickname` posts the player's results in the channel as they finish games. Run it again to stop. The list is kept in memory, so a restart clears it.

- `/er 닉네임`: 현재 랭크 RP, 최근 경기 요약, 많이 한 실험체, 최근 5경기를 보여 줍니다.
- `/er-watch 닉네임`: 그 플레이어가 경기를 끝낼 때마다 이 채널에 결과를 올립니다. 다시 입력하면 알림이 꺼집니다. 목록은 메모리에만 있어서 봇을 다시 켜면 사라집니다.

```sh
cd examples/discord-bot
npm install
DISCORD_TOKEN=... ER_API_KEY=... GUILD_ID=... npm start
```

- `DISCORD_TOKEN`: bot token from the [Discord Developer Portal](https://discord.com/developers/applications). Invite the bot with the `bot` and `applications.commands` scopes.
- `ER_API_KEY`: key from [developer.eternalreturn.io](https://developer.eternalreturn.io).
- `GUILD_ID` (optional): registers the commands in one server right away. Without it, the commands are registered globally.

`profile.mjs` has no Discord code, so you can reuse it for other bots or a CLI.
