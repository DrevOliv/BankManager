function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export const config = {
  /** Image tag the container was built with (set by the Dockerfile). */
  version: env('APP_VERSION', 'dev'),
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgres://bankmanager:bankmanager@localhost:5432/bankmanager'),
  /** Set to "true" when the app is served over HTTPS (e.g. behind a reverse proxy). */
  cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
  sessionDays: Number(env('SESSION_DAYS', '30')),
  /** Default Ollama endpoint; can be changed later from the Settings page. */
  ollamaUrl: env('OLLAMA_URL', 'http://host.docker.internal:11434'),
  ollamaModel: env('OLLAMA_MODEL', 'llama3.2:3b'),
  baseCurrency: 'SEK',
  maxUploadMb: Number(env('MAX_UPLOAD_MB', '20')),
  webDist: env('WEB_DIST', new URL('../../web/dist', import.meta.url).pathname),
};
