# Releasing

Releases are published from GitHub Actions through npm trusted publishing. No npm token or local login is needed.

1. Bump the version: `npm version patch` (or `minor`). This updates `package.json`, commits, and creates the tag.
2. Push the commit and tag: `git push --follow-tags`.
3. The Publish workflow checks that the tag matches `package.json`, runs the tests, and publishes.

One-time setup on npmjs.com: package Settings → Trusted Publisher → GitHub Actions, with owner `adgjmptw2`, repository `eternal-return-api`, workflow `publish.yml`, environment `npm`.
