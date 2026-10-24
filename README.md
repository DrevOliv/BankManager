# BankManager

A self-hosted overview of where your money goes, for **Handelsbanken** and **Revolut**. Upload your bank statements and see your balance, what you spend per category and how this month compares with the last one. Transfers between your own accounts and duplicate rows are sorted out automatically.

## Features

- **Overview:** money available right now, spending by category, spending pace compared with last month, income vs spending per month, top places and an optional monthly budget.
- **Import:** drop in Handelsbanken `.xlsx` and Revolut `.csv`/`.xlsx` statements.
  - Overlapping uploads are safe: duplicates are skipped.
  - Pending rows are replaced once they're booked.
- **Transfers between your own accounts are hidden**, for example Handelsbanken `Revolut**3387*` → Revolut `Apple Pay deposit`. Savings and investments are tracked separately from spending.
- **Swish and bank badges** on every transaction.
- **Rules:** change a category once and tick *Always use this* to apply it to that merchant from now on.
- **Months that follow your salary:** a month can start on the day your salary or CSN arrives instead of the 1st.
- **AI assistant (optional):** runs on your own Ollama server.
  - Chat about your spending.
  - Monthly insights.
  - Automatic categorisation of unknown merchants.
- Username/password login. The first start shows a setup screen for the admin account.

## Getting started

### Option 1: from source

```bash
cp .env.example .env      # set POSTGRES_PASSWORD to something long and random
make up                   # same as: docker compose up -d --build
```

### Option 2: from Docker Hub (no source code needed)

Copy [`deploy/docker-compose.yml`](deploy/docker-compose.yml) and `.env.example` (saved as `.env`) to a folder on your server. Set `POSTGRES_PASSWORD` in `.env`, then run:

```bash
docker compose up -d
```

Either way, open <http://localhost:8080> (or `http://<server-ip>:8080`), create your admin account and go to **Import**.

## Building and publishing the image

The Makefile wraps `docker buildx`. The image name defaults to `drevoliv/bankmanager`:

| Command | What it does |
| --- | --- |
| `make build` | Builds `drevoliv/bankmanager:latest` for this machine and loads it into your local Docker |
| `make push` | Builds for `linux/amd64` and `linux/arm64` and pushes `drevoliv/bankmanager:latest` |
| `make push 1.2.0` | Same, and tags it both `1.2.0` and `latest` |
| `make push someone/bankmanager:1.2.0` | Uses a different image name |
| `make up` / `make down` / `make logs` | Start, stop or follow the app with Docker Compose (from source) |
| `make test` | Runs the server tests |
| `make help` | Lists all commands |

To publish, log in once with `docker login`, then run `make push 1.0.0`.

- The first `push` creates a buildx builder called `bankmanager-builder`.
- The image works on both Intel/AMD servers and ARM machines such as a Raspberry Pi or Apple Silicon.
- The version is shown at the bottom of the Settings page.
- Variables work too: `make push IMAGE=someone/bankmanager TAG=1.0.0 PLATFORMS=linux/amd64`.

Your `.env` and the `samples/` folder are excluded from the image by `.dockerignore`.

## Configuration

Set these in `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | *(required)* | Password for the bundled Postgres database |
| `APP_PORT` | `8080` | Port the app is published on |
| `BANKMANAGER_IMAGE` | `drevoliv/bankmanager:latest` | Image used by `deploy/docker-compose.yml` |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Your Ollama server (`host.docker.internal` is the Docker host) |
| `OLLAMA_MODEL` | `llama3.2:3b` | Model to use; any small instruct model works |
| `COOKIE_SECURE` / `TRUST_PROXY` | `false` | Set both to `true` behind an HTTPS reverse proxy |
| `TZ` | `Europe/Stockholm` | Timezone used for "today" and the month boundaries |

Everything else is set in the app under **Settings**: when your month starts, your monthly budget, accounts, the AI connection, exchange rates and users.

## AI assistant

The assistant uses your existing [Ollama](https://ollama.com) server. Install a small model such as `llama3.2:3b` or `qwen2.5:3b`. Then set the URL and model in `.env` or under **Settings → AI assistant**, which also shows whether Ollama is reachable.

- If Ollama runs on another computer, start it with `OLLAMA_HOST=0.0.0.0` and use that computer's address, e.g. `http://192.168.1.50:11434`.
- The app calculates the numbers itself and gives the model a short summary, so even a 3B model gives sensible answers. Your data is only sent to your own Ollama server.
- Categorisation asks the model three slightly different ways and keeps the majority answer. Each answer is saved as a rule you can change under **Categories → Learned by AI**.

Everything else works without AI. Turn it off in Settings and the AI cards disappear.

## How it works

| | Handelsbanken | Revolut |
| --- | --- | --- |
| File | Excel export (`.xlsx`); old HTML-style `.xls` also works | Account statement (`.csv` or `.xlsx`, English or Swedish) |
| Pending rows | No *Reskontradatum* (`Prel …`) | `State = PENDING` |
| Balance | `Saldo:` in the header | Balance of the newest completed row |

- **Duplicates:** each row is fingerprinted from its date, text, amount and type. Identical rows in one file are numbered, so two 500 kr top-ups on the same day stay two rows, and importing the same file again adds nothing.
- **Pending rows** from an earlier upload are replaced by what the newer file says for that period. Categories you picked by hand carry over.
- **Transfers:** money leaving one of your accounts and the same amount arriving in another within 4 days is paired and left out of the statistics, as long as both texts look like a transfer (`Revolut**`, `Apple Pay deposit`, `Överf` and so on). You can still see these under **Transactions → Transfers**.
- **Money available** is the bank balance minus pending card payments, which the bank exports don't subtract.
- **Months:** under **Settings → When does your month start?** you pick the day your money usually arrives, e.g. the 25th.
  - The month then starts on the day salary, CSN or other income (not Swish) actually arrives, within 10 days before to 6 days after that day.
  - If nothing has arrived yet, it starts on that day, or the banking day before if it's a weekend or Swedish holiday.
  - A month is named after the month it starts in, so 22 Oct – 24 Nov is *October*.
- **Undo:** every import can be undone from the import history.

## Updating and backups

```bash
# From source
git pull && make up

# From Docker Hub
docker compose pull && docker compose up -d
```

Database migrations run automatically when the app starts. To back up and restore the database:

```bash
docker compose exec db pg_dump -U bankmanager bankmanager > backup.sql
docker compose exec -T db psql -U bankmanager bankmanager < backup.sql
```

## Security

- Passwords are hashed with bcrypt.
- Sessions are random tokens in an HttpOnly cookie.
- Login attempts are rate-limited.
- To reach the app from outside your home network, put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- All users see the same data. Only admins can add or remove users.

## Development

You need Node 22+ and a Postgres database.

```bash
# API on :3001
cd server && npm install
DATABASE_URL=postgres://user:pass@localhost:5432/bankmanager PORT=3001 npm run dev

# Frontend on :5173 (proxies /api to :3001)
cd web && npm install && npm run dev

# Tests (the API test needs a throwaway database; it wipes it)
cd server && TEST_DATABASE_URL=postgres://user:pass@localhost:5432/bankmanager_test npm test
```

| Path | Contents |
| --- | --- |
| `server/src/import/` | File readers, bank parsers, Swish detection, merchant clean-up |
| `server/src/categorize.ts` | Rule engine |
| `server/src/transfers.ts` | Transfer matching |
| `server/src/period.ts` | Month boundaries (payday, banking days, income detection) |
| `server/src/stats.ts` | Numbers for the overview |
| `server/src/ai/` | Ollama client and AI features |
| `web/src/` | React app (Vite, Tailwind, Recharts) |
| `deploy/` | Compose file for running the published image |
