# grampacker

A website for backpacking gear lists:
[grampacker.app](https://grampacker.app).

Enter your gear and its weight, and grampacker shows the total weight of your
pack, with base weight, worn weight and consumables shown separately. Pack
mode sorts a list by where each item goes in your pack, with a Ready checkbox
and a Packed checkbox for each item. You can print a list, plan food by day
and meal, and share a read-only link to a list.

Sign-in uses passkeys and sign-in links sent by email. There are no
passwords.

## Run it locally

Needs Node 24.

```sh
npm ci
npm run dev
```

The dev server runs at http://localhost:5173 with a SQLite database in
`.data/`. With no email key set, sign-in links print to the terminal. Local
development never contacts production.

## Host your own copy

grampacker runs as one Node process with a SQLite file. Production uses a
Docker image behind Caddy, which provides HTTPS. Passkeys need HTTPS, and
they stop working if the site moves to another domain.

Settings, as environment variables:

| Variable | Needed | What it is |
| --- | --- | --- |
| `BETTER_AUTH_URL` | yes | The site's public URL, e.g. `https://packs.example.com` |
| `BETTER_AUTH_SECRET` | yes | A long random string; signs sessions |
| `RESEND_API_KEY` | yes | A [Resend](https://resend.com) API key. Without it, nobody can sign in |
| `EMAIL_FROM` | no | The sender address for sign-in emails |
| `DATABASE_PATH` | no | Default `/data/grampacker.db` |
| `PORT`, `HOST` | no | Default `3000` on `127.0.0.1` |

The server does not change the database schema. It refuses to start while a
migration is pending, so run the image's `migrate` command first. Building,
running and checking the image:
[docs/container-image.md](./docs/container-image.md). The
[runbook for grampacker.app](./docs/vps-runbook.md) shows a full setup on one
server, with Docker Compose and Caddy.

## Development

```sh
npm ci             # not `npm install`, which can rewrite the lockfile (dependency changes: SECURITY.md)
npm run dev        # SPA + /api/* on Node + local SQLite (.data/), one process
npm test           # unit tests + api tests
npm run test:unit  # unit tests only
npm run test:api   # api tests: the real app on Node against SQLite
npm run typecheck  # tsc -b
npm run build      # typecheck + lint + client and server production builds
npm run test:migrations  # migration bookkeeping and safety; fetch origin/main first
npm run db:migrate       # apply migrations to DATABASE_PATH (tsx, development)
npm run build:server     # compile the server to dist/server
npm run start:node       # run the compiled server, as production does
```

Production runs the compiled JavaScript; tsx is for local development only.

- Code layout: `src/` is the React app, `server/` the Hono API (it owns the
  database through `server/db`), `shared/` the zod contracts both sides
  import, and `migrations/` the SQL migrations drizzle-kit generates.
- Rules for changes, for people and coding agents: [AGENTS.md](./AGENTS.md).
- Test tiers and CI: [docs/testing-and-ci.md](./docs/testing-and-ci.md).
- Security model and known gaps: [SECURITY.md](./SECURITY.md).
- Why each dependency is used: [STACK.md](./STACK.md).
- Ideas put off until something triggers them: [PARKED.md](./PARKED.md).
- Supported browsers: Chrome 117, Firefox 119, Safari 17.4 and later.

Report a problem: [GitHub issues](https://github.com/joes703/grampacker/issues).

## License

MIT. See [LICENSE](./LICENSE).
