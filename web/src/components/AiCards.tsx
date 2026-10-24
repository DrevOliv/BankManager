import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, RefreshCw, Sparkles } from 'lucide-react';
import { api, streamText } from '../lib/api';
import { askAssistant } from '../lib/chat';
import { useAiStatus } from '../lib/queries';
import { Button, Card, CardHeader, cx } from './ui';

/** Renders **bold** inside a line as <strong>, without ever using innerHTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** Renders "- item" / "1. item" lines as a list and keeps other text as paragraphs. */
export function AiText({ text, streaming }: { text: string; streaming: boolean }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-ink">
      {lines.map((l, i) => {
        const bullet = /^([-*•]|\d+\.)\s+/.test(l);
        const last = i === lines.length - 1;
        const content = inline(l.replace(/^([-*•]|\d+\.)\s+/, ''));
        return bullet ? (
          <div key={i} className="flex gap-2.5">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <p className={cx(last && streaming && 'caret')}>{content}</p>
          </div>
        ) : (
          <p key={i} className={cx(last && streaming && 'caret')}>
            {content}
          </p>
        );
      })}
      {!lines.length && streaming && <p className="caret text-muted">Thinking</p>}
    </div>
  );
}

export function useAiReady() {
  const status = useAiStatus();
  const s = status.data;
  return { ready: !!s?.enabled && s.reachable && s.modelAvailable, status: s, loading: status.isLoading };
}

export function AiUnavailable() {
  const { status: s } = useAiReady();
  if (!s) return null;
  const msg = !s.enabled
    ? 'AI features are turned off.'
    : !s.reachable
      ? `Can't reach Ollama at ${s.url}.`
      : !s.modelAvailable
        ? `The model “${s.model}” isn't installed in Ollama.`
        : null;
  if (!msg) return null;
  return (
    <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
      {msg}{' '}
      <Link to="/settings" className="font-medium text-accent-ink underline-offset-2 hover:underline">
        Check AI settings
      </Link>
    </p>
  );
}

export function InsightsCard({ month }: { month: string }) {
  const { ready, status } = useAiReady();
  const cached = useQuery({
    queryKey: ['insights', month],
    queryFn: () => api.get<{ text: string | null }>(`/api/ai/insights?month=${month}`),
    enabled: ready,
  });
  const [text, setText] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    return () => abort.current?.abort();
  }, [month]);

  const generate = async (refresh: boolean) => {
    abort.current?.abort();
    abort.current = new AbortController();
    setStreaming(true);
    setError(null);
    setText('');
    try {
      await streamText('/api/ai/insights', { month, refresh }, setText, abort.current.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      setText(null);
    } finally {
      setStreaming(false);
    }
  };

  const shown = text ?? cached.data?.text ?? null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" /> Insights
          </span>
        }
        subtitle={`A short summary of the month · ${status?.model ?? 'local AI'}`}
        action={
          shown && !streaming ? (
            <Button size="sm" variant="ghost" onClick={() => generate(true)} title="Regenerate">
              <RefreshCw size={14} />
            </Button>
          ) : null
        }
      />
      <div className="px-5 pb-5">
        {!ready ? (
          <AiUnavailable />
        ) : shown !== null && (shown || streaming) ? (
          <AiText text={shown} streaming={streaming} />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[14px] text-ink-2">Get a plain-language summary of this month: what changed, where the money went, and one tip.</p>
            <Button variant="primary" size="sm" onClick={() => generate(false)} loading={streaming}>
              <Sparkles size={14} /> Generate insights
            </Button>
          </div>
        )}
        {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}
      </div>
    </Card>
  );
}

const SUGGESTIONS = ['Where can I cut back?', 'How much did I spend on food?', 'What was my biggest purchase?', 'Which subscriptions do I pay for?'];

/** Compact entry point on the overview; the conversation continues on the Assistant page. */
export function AskCard({ month }: { month: string }) {
  const { ready } = useAiReady();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');

  const ask = (q: string) => {
    if (!q.trim()) return;
    askAssistant(q, month);
    navigate(`/assistant?month=${month}`);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  return (
    <Card>
      <CardHeader
        title="Ask about your money"
        subtitle="Answered by your own Ollama model; nothing leaves your server."
        action={
          <Link to={`/assistant?month=${month}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">
            Assistant <ArrowRight size={14} />
          </Link>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        {!ready ? (
          <AiUnavailable />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] text-ink-2 transition hover:bg-hover hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="relative">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. How much have I spent at Coop this month?"
                maxLength={500}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface pr-12 pl-3.5 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-3 focus:ring-accent-wash"
              />
              <button
                type="submit"
                disabled={!question.trim()}
                className="absolute top-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-40"
                aria-label="Ask"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </form>
          </>
        )}
      </div>
    </Card>
  );
}
