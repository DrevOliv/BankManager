CREATE TABLE users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,               -- sha256 of the cookie token
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE accounts (
  id                 serial PRIMARY KEY,
  bank               text NOT NULL,          -- 'handelsbanken' | 'revolut'
  external_id        text NOT NULL,          -- account number, or product:currency for Revolut
  name               text NOT NULL,
  currency           text NOT NULL DEFAULT 'SEK',
  include_in_balance boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank, external_id)
);

CREATE TABLE categories (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  kind       text NOT NULL CHECK (kind IN ('expense', 'income', 'savings', 'transfer')),
  icon       text NOT NULL DEFAULT 'tag',
  color      text NOT NULL DEFAULT '#898781',
  sort_order int NOT NULL DEFAULT 100,
  system_key text UNIQUE                     -- stable key for categories the code refers to
);

CREATE TABLE imports (
  id                    serial PRIMARY KEY,
  filename              text NOT NULL,
  bank                  text NOT NULL,
  user_id               int REFERENCES users(id) ON DELETE SET NULL,
  period_start          date,
  period_end            date,
  rows_total            int NOT NULL DEFAULT 0,
  rows_inserted         int NOT NULL DEFAULT 0,
  rows_duplicate        int NOT NULL DEFAULT 0,
  rows_pending_replaced int NOT NULL DEFAULT 0,
  rows_skipped          int NOT NULL DEFAULT 0,
  transfers_matched     int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id               bigserial PRIMARY KEY,
  account_id       int NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  import_id        int REFERENCES imports(id) ON DELETE CASCADE,
  external_key     text NOT NULL,            -- content hash used to drop duplicate rows
  date             date NOT NULL,            -- when the purchase/transfer happened
  booked_date      date,
  occurred_at      timestamp,                -- local wall-clock time when the bank provides one
  description      text NOT NULL,            -- raw bank text
  merchant         text NOT NULL,            -- cleaned-up display name
  amount           numeric(14, 2) NOT NULL,  -- signed, in the account currency, fees included
  currency         text NOT NULL,
  balance          numeric(14, 2),
  raw_type         text,
  channel          text NOT NULL DEFAULT 'other',
  status           text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'pending')),
  category_id      int REFERENCES categories(id) ON DELETE SET NULL,
  category_source  text NOT NULL DEFAULT 'none' CHECK (category_source IN ('none', 'rule', 'ai', 'user', 'transfer')),
  transfer_peer_id bigint REFERENCES transactions(id) ON DELETE SET NULL,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_key)
);
CREATE INDEX transactions_date_idx ON transactions (date);
CREATE INDEX transactions_category_idx ON transactions (category_id);
CREATE INDEX transactions_merchant_idx ON transactions (lower(merchant));
CREATE INDEX transactions_import_idx ON transactions (import_id);

CREATE TABLE rules (
  id          serial PRIMARY KEY,
  pattern     text NOT NULL,
  match_type  text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'word', 'exact', 'regex')),
  direction   text NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'in', 'out')),
  category_id int NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source      text NOT NULL DEFAULT 'user' CHECK (source IN ('system', 'user', 'ai')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE balance_snapshots (
  account_id int NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of      timestamp NOT NULL,         -- local wall-clock time
  balance    numeric(14, 2) NOT NULL,
  import_id  int REFERENCES imports(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, as_of)
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- Rates used to convert non-SEK transactions into SEK for the statistics.
CREATE TABLE fx_rates (
  currency text PRIMARY KEY,
  rate     numeric(14, 6) NOT NULL
);
INSERT INTO fx_rates (currency, rate) VALUES
  ('SEK', 1), ('EUR', 11.0), ('USD', 9.5), ('GBP', 12.8), ('NOK', 0.9), ('DKK', 1.47);

-- Every statistic reads from this view: amounts in SEK plus the effective kind.
CREATE VIEW tx_view AS
SELECT
  t.*,
  round(t.amount * coalesce(fx.rate, 1), 2) AS amount_sek,
  c.name  AS category_name,
  c.icon  AS category_icon,
  c.color AS category_color,
  coalesce(c.kind, CASE WHEN t.amount < 0 THEN 'expense' ELSE 'income' END) AS kind,
  a.bank,
  a.name  AS account_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN fx_rates fx ON fx.currency = t.currency;
