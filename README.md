# Simple SMTP Test

A self-hosted SMTP testing tool with English/German UI and light/dark themes. Check connections
and authentication, send text or HTML test emails, view live logs, and export
results as JSON. Supports STARTTLS, TLS, and unencrypted SMTP. Language and theme
follow browser preferences by default and can be overridden in the header.

## About this project

This tool is AI-generated. I work in IT infrastructure and created it to make
everyday troubleshooting easier. It is intended to run locally or behind a
reverse proxy with an authentication layer. It has not been hardened for direct
exposure to the public internet.

## Microsoft 365 OAuth (preview branch)

Choose **Microsoft 365 OAuth** and enter your existing Tenant ID, Application
(Client) ID, Client Secret **value**, and authentication mailbox. Test token
acquisition and SMTP authentication, or send a test email. Requires Exchange
Online `SMTP.SendAsApp`, admin consent, mailbox permissions, and SMTP AUTH.
See [OAuth test notes](docs/m365-oauth.md).

This branch builds `codex/m365-oauth`; `main` remains the stable SMTP version.

## Docker Compose

```bash
curl -fsSL https://raw.githubusercontent.com/forke24x7/simple-smtp-test/codex/m365-oauth/docker-compose.yml -o docker-compose.yml
docker compose up -d --build
```

Open `http://<docker-host>:3008`. To change the host port, set
`SMTP_TEST_PORT=3010` in a `.env` file. No database or volumes are required.
Only the Compose file is needed. Docker fetches the source and Dockerfile from
GitHub and builds the image. The Docker host needs internet access for the build.
Re-run `docker compose up -d --build` to rebuild and deploy updates.

## Development

Requires Node.js 22.12+ and pnpm 9+.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
NODE_ENV=production pnpm start
```

## Deployment notes

- SMTP servers must be reachable from the container. A successful send confirms
  server acceptance, not inbox delivery.
- Credentials are processed by the app server, never persisted, and excluded
  from exports. Use HTTPS and access control outside a trusted network.
- Disable reverse-proxy response buffering for `/api/test` to keep logs live.

## License

Licensed under the [MIT License](LICENSE). Free to use, modify, and redistribute,
including commercially, provided the copyright and license notices are retained.
