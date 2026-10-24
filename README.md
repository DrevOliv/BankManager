# BankManager

A self-hosted overview of where your money goes, for **Handelsbanken** and **Revolut**.

- **Overview:** money available right now across both banks, spending by category, spending pace compared with last month, income vs spending per month, top places, and an optional monthly budget with a daily allowance.
- **Import:** drop Handelsbanken `.xlsx` and Revolut `.csv`/`.xlsx` statements. Re-uploading overlapping files is safe because duplicates are skipped.
- **Transfers between your own accounts are hidden.** For example, Handelsbanken `Revolut**3387*` −500 kr is paired with Revolut `Apple Pay deposit` +500 kr, so neither counts as spending or income. Savings such as Robo portfolio and Avanza are tracked separately from spending.
- **Badges** show which bank each transaction came from, and mark **Swish** payments. Handelsbanken shows Swish as just the other person's name, which is detected automatically.
- **Pending transactions** are included, then replaced by the booked version when you upload a newer statement.
- **Categories and rules:** change a category once and tick *Always use this* to create a rule for that merchant.
- **Months that follow your salary:** under *Settings → When does your month start?* you can set the day your month starts, for example payday on the 25th.
  - When that day falls on a weekend or Swedish bank holiday, the month starts on the banking day before, just like salaries are paid.
  - A month is named after the calendar month most of its days fall in, so 23 Oct – 24 Nov is "November". The date range is always shown.
- **AI assistant (Ollama, optional):** the *Assistant* page has three features.
  - A chat about your money that understands follow-up questions.
  - Monthly insights.
  - Auto-categorisation: three prompts vote on each unknown merchant, and the answer is saved as a rule.
  - The model is given precomputed totals, places, recurring payments and recent transactions, so a small 3B model doesn't have to do arithmetic.
- Login with username and password. The first start shows a setup screen for the admin account.

## Quick start (Docker Compose)

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD to something long
docker compose up -d --build
```

Open <http://localhost:8080> (or `http://<server-ip>:8080`) and create your admin account.

Then go to **Import** and drop in your statements.

## Ollama

The app talks to your existing Ollama server. Set `OLLAMA_URL` and `OLLAMA_MODEL` in `.env`, or change them later on the **Settings** page. Settings has a status line that tells you whether Ollama is reachable and whether the model is installed.

| Where Ollama runs | `OLLAMA_URL` |
| --- | --- |
| Same machine as Docker | `http://host.docker.internal:11434` (default) |
| Another computer on your network | `http://192.168.1.50:11434` |

If Ollama runs on another computer, start it with `OLLAMA_HOST=0.0.0.0` so it accepts connections from the network. Any small instruct model works, for example `llama3.2:3b` or `qwen2.5:3b`. Everything else works without AI.

## How the import works

| | Handelsbanken | Revolut |
| --- | --- | --- |
| File | Excel export (`.xlsx`). Older HTML-style `.xls` also works. | Account statement (`.csv` or `.xlsx`, English or Swedish) |
| Pending | Rows without *Reskontradatum* (`Prel …`) | `State = PENDING` |
| Balance | `Saldo:` in the header | Balance of the newest completed row |

- **Duplicates:** each row gets a fingerprint from its date, text, amount and type. Identical rows within one file are numbered, so two 500 kr top-ups on the same day stay two rows, and re-importing never adds them again.
- **Pending rows** from an earlier upload are replaced by whatever the newer file says for that period. Any category you picked by hand carries over to the booked version.
- **Transfers:** money leaving one account and the same amount arriving in another within 4 days, where both texts look like a transfer (`Revolut**`, `Apple Pay deposit`, `Överf`, top-up and so on), are paired. Both sides are then left out of the statistics. They can still be seen under *Transactions → Transfers*.
- **Money available** is the bank balance minus pending card payments, which banks don't subtract in their exports.
- **Undo:** every import can be undone from the import history.

## Updating and backups

```bash
git pull && docker compose up -d --build     # database migrations run automatically

# Backup / restore the database
docker compose exec db pg_dump -U bankmanager bankmanager > backup.sql
docker compose exec -T db psql -U bankmanager bankmanager < backup.sql
```

## Security notes

- Passwords are hashed with bcrypt. Sessions are random tokens in an HttpOnly cookie, and login attempts are rate-limited.
- If you expose the app outside your home network, put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) and set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.
- All users see the same data. Only admins can add or remove users.

## Development

Requirements: Node 22+ and a Postgres database.

```bash
# API on :3001
cd server && npm install
DATABASE_URL=postgres://user:pass@localhost:5432/bankmanager PORT=3001 npm run dev

# Frontend on :5173 (proxies /api to :3001)
cd web && npm install && npm run dev

# Tests: parser tests always run; the API test needs a throwaway database (it wipes it)
cd server && TEST_DATABASE_URL=postgres://user:pass@localhost:5432/bankmanager_test npm test
```

Project layout:

- `server/src/import/`: file readers, bank parsers, Swish detection and merchant clean-up
- `server/src/categorize.ts`: rule engine
- `server/src/transfers.ts`: transfer matching
- `server/src/stats.ts`: numbers for the overview
- `server/src/ai/`: Ollama client and AI features
- `web/src/`: React app (Vite, Tailwind, Recharts)
