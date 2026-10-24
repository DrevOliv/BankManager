import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Bot, CircleHelp, Lightbulb, PiggyBank, RotateCcw, Search, ShieldCheck, Sparkles, Tags } from 'lucide-react';
import { askAssistant, resetChat, useChat } from '../lib/chat';
import { monthName, rangeLabel } from '../lib/format';
import { useAiCategorize, useTransactions } from '../lib/queries';
import type { AiCategorizeResult } from '../lib/types';
import { AiText, AiUnavailable, InsightsCard, useAiReady } from '../components/AiCards';
import { MonthPicker, useMonth, usePeriodInfo } from '../components/MonthPicker';
import { Button, Card, CardHeader, Spinner, cx, useToast } from '../components/ui';

const GROUPS = [
  {
    title: 'Understand your month',
    icon: Lightbulb,
    questions: ['Summarise my month in three points', 'Am I spending more than last month?', 'Which weekday do I spend the most on?'],
  },
  {
    title: 'Find ways to save',
    icon: PiggyBank,
    questions: ['Where can I cut back?', 'Which subscriptions and recurring payments do I have?', 'How much do I spend on eating out?'],
  },
  {
    title: 'Look things up',
    icon: Search,
    questions: ['How much did I spend on food?', 'What was my biggest purchase?', 'How much have I sent and received with Swish?'],
  },
];

export function AssistantPage() {
  const [month, setMonth] = useMonth();
  const { ready, status, loading } = useAiReady();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles size={22} className="text-accent" /> Assistant
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {status?.model ? `Runs on ${status.model} on your own Ollama server. Your bank data never leaves your network.` : 'Your private money assistant.'}
          </p>
        </div>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : !ready ? (
        <SetupCard />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <ChatCard month={month} />
          <div className="space-y-5">
            <InsightsCard month={month} />
            <CategorizeCard />
            <PrivacyCard />
          </div>
        </div>
      )}
    </div>
  );
}

function ChatCard({ month }: { month: string }) {
  const { messages, streaming } = useChat();
  const { range } = usePeriodInfo();
  const [question, setQuestion] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const r = range(month);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    askAssistant(question, month);
    setQuestion('');
  };

  return (
    <Card className="flex min-h-[560px] flex-col lg:h-[calc(100vh-170px)]">
      <CardHeader
        title="Chat"
        subtitle={`Questions are about ${monthName(month)}${r ? ` (${rangeLabel(r.start, r.end)})` : ''}, plus the months before it.`}
        action={
          messages.length ? (
            <Button size="sm" variant="ghost" onClick={resetChat}>
              <RotateCcw size={14} /> New chat
            </Button>
          ) : null
        }
      />
      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-4">
        {messages.length === 0 ? (
          <div className="space-y-5 pt-2">
            <div className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
                <Bot size={18} />
              </span>
              <p className="text-[14px] leading-relaxed text-ink-2">
                Hi! I can read your spending for the selected month and the months before it: categories, places, recurring payments, Swish and your
                latest transactions. Ask me anything, or pick a question below. Follow-up questions work too.
              </p>
            </div>
            {GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">
                  <g.icon size={13} /> {g.title}
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.questions.map((q) => (
                    <button
                      key={q}
                      onClick={() => askAssistant(q, month)}
                      className="rounded-full border border-line-strong px-3 py-1.5 text-left text-[13px] text-ink-2 transition hover:border-accent hover:bg-accent-wash hover:text-ink"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <p key={i} className="animate-in ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-white">
                {m.content}
              </p>
            ) : (
              <div key={i} className="animate-in flex max-w-[95%] gap-2.5">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
                  <Bot size={15} />
                </span>
                <div className={cx('min-w-0 rounded-2xl rounded-tl-md px-3.5 py-2.5', m.error ? 'bg-bad/10 text-bad' : 'bg-surface-2')}>
                  {m.error ? <p className="text-[14px]">{m.content}</p> : <AiText text={m.content} streaming={streaming && i === messages.length - 1} />}
                </div>
              </div>
            ),
          )
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="border-t border-line p-3">
        <div className="relative">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={messages.length ? 'Ask a follow-up…' : 'Ask about your money…'}
            maxLength={500}
            className="h-11 w-full rounded-xl border border-line-strong bg-surface pr-12 pl-3.5 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-3 focus:ring-accent-wash"
          />
          <button
            type="submit"
            disabled={!question.trim() || streaming}
            className="absolute top-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-muted">Small local models can make mistakes. Numbers on the Overview page are always exact.</p>
      </form>
    </Card>
  );
}

function CategorizeCard() {
  const toast = useToast();
  const categorize = useAiCategorize();
  const { data } = useTransactions({ category: 'none', limit: 1 });
  const [result, setResult] = useState<AiCategorizeResult | null>(null);
  const waiting = data?.total ?? 0;

  const run = () =>
    categorize.mutate(undefined, {
      onSuccess: (r) => setResult(r),
      onError: (e) => toast((e as Error).message, 'error'),
    });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Tags size={16} className="text-accent" /> Auto-categorise
          </span>
        }
        subtitle="For merchants no rule recognises. Each answer becomes a rule, so it only has to learn a merchant once."
      />
      <div className="space-y-3 px-5 pb-5">
        {categorize.isPending ? (
          <p className="flex items-center gap-2 text-[14px] text-ink-2">
            <Spinner /> Thinking about each merchant (about a second each)…
          </p>
        ) : result ? (
          <>
            <p className="text-[14px] text-ink">
              Categorised <b>{result.categorized}</b> of {result.merchants} merchants{result.remaining ? ` · ${result.remaining} left` : ''}.
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {result.results.map((r) => (
                <li key={r.merchant} className="px-3 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.merchant}</span>
                    <span className="shrink-0 text-ink-2">{r.category}</span>
                  </div>
                  <p className="text-[12px] text-muted">
                    {r.business ? `Looks like: ${r.business}` : ''}
                    {!r.sure && <span className="ml-1 rounded bg-warning/15 px-1 text-ink-2">unsure</span>}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-muted">
              Wrong? Change it on the transaction and tick “Always use this”, or edit it under{' '}
              <Link to="/categories" className="text-accent-ink hover:underline">
                Categories → Learned by AI
              </Link>
              .
            </p>
            {result.remaining > 0 && (
              <Button size="sm" onClick={run}>
                Continue with the next {Math.min(25, result.remaining)}
              </Button>
            )}
          </>
        ) : waiting > 0 ? (
          <>
            <p className="text-[14px] text-ink-2">
              <b className="text-ink">{waiting}</b> transaction{waiting === 1 ? '' : 's'} {waiting === 1 ? "doesn't" : "don't"} have a category.
            </p>
            <Button variant="primary" size="sm" onClick={run}>
              <Sparkles size={14} /> Categorise with AI
            </Button>
          </>
        ) : (
          <p className="text-[14px] text-ink-2">Everything has a category right now. New merchants from your next import can be categorised here.</p>
        )}
      </div>
    </Card>
  );
}

function PrivacyCard() {
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <ShieldCheck size={16} className="text-good" /> What the assistant sees
      </p>
      <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
        <li>• Totals and categories for the selected month, with the places behind them</li>
        <li>• The trend over the previous months and recurring payments</li>
        <li>• Your 30 latest transactions and current balances</li>
      </ul>
      <p className="mt-3 text-[12px] text-muted">
        It is sent only to your own Ollama server. The numbers are calculated by the app first, so the small model doesn't have to do maths.
      </p>
    </Card>
  );
}

function SetupCard() {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-wash text-accent">
          <CircleHelp size={22} />
        </span>
        <div className="space-y-3">
          <div>
            <p className="font-semibold">Connect your Ollama server to use the assistant</p>
            <AiUnavailable />
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-[14px] text-ink-2">
            <li>Make sure Ollama is running and reachable from the BankManager container.</li>
            <li>
              Install a small model, for example <code className="rounded bg-surface-2 px-1">ollama pull llama3.2:3b</code>.
            </li>
            <li>
              Enter the URL and model under{' '}
              <Link to="/settings" className="font-medium text-accent-ink hover:underline">
                Settings → AI assistant
              </Link>
              .
            </li>
          </ol>
          <p className="text-[13px] text-muted">
            Once connected, the assistant can summarise your month, answer questions like “Where can I cut back?”, and categorise unknown merchants.
          </p>
        </div>
      </div>
    </Card>
  );
}
