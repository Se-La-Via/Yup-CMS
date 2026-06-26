# Contributing to Yup CMS

Thanks for your interest! Yup CMS is early and contributions are welcome.

## Development setup

```bash
git clone https://github.com/Se-La-Via/Yup-CMS.git
cd Yup-CMS
npm install
npm run setup          # writes .env (interactive)
docker compose up -d db # or point DATABASE_URL at any Postgres
npm run db:migrate
```

## Before opening a PR

Run the same checks CI runs:

```bash
npm run typecheck      # tsc, no errors
npm test               # unit tests (node:test)
npm run build          # production build compiles
```

If your change touches the database, run `npm run seed` against a local Postgres
to exercise the full path end to end.

## Guidelines

- **Match the surrounding style.** Small, focused functions; comments explain
  *why*, not *what*.
- **Keep the trust model intact.** Write identity comes from the server principal,
  never from request arguments — see [SECURITY.md](SECURITY.md). Changes to the
  review gate or attribution should add tests in `src/core/policy.test.ts`.
- **Schema changes need a migration.** Edit `src/db/schema.ts`, then
  `npm run db:generate` and commit the generated SQL in `drizzle/`.
- **Two surfaces, two roles.** Agents write through the MCP server; front-ends
  read through the HTTP API. Keep writes out of the read API.

## Reporting bugs / ideas

Open an issue. For security reports, see [SECURITY.md](SECURITY.md).
