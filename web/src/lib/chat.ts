import { useSyncExternalStore } from 'react';
import { streamText } from './api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  streaming: boolean;
}

// One conversation for the whole app, so it survives moving between pages.
let state: ChatState = { messages: [], streaming: false };
const listeners = new Set<() => void>();
let abort: AbortController | null = null;

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function replaceLast(message: ChatMessage) {
  const messages = state.messages.slice();
  messages[messages.length - 1] = message;
  set({ messages });
}

export async function askAssistant(question: string, month: string) {
  const q = question.trim();
  if (!q || state.streaming) return;
  // Earlier turns let follow-ups like "and the month before?" work.
  const history = state.messages.filter((m) => !m.error && m.content).slice(-6).map(({ role, content }) => ({ role, content }));
  set({ messages: [...state.messages, { role: 'user', content: q }, { role: 'assistant', content: '' }], streaming: true });
  abort = new AbortController();
  try {
    await streamText('/api/ai/ask', { question: q, month, history }, (text) => replaceLast({ role: 'assistant', content: text }), abort.signal);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') replaceLast({ role: 'assistant', content: (err as Error).message, error: true });
  } finally {
    set({ streaming: false });
  }
}

export function resetChat() {
  abort?.abort();
  set({ messages: [], streaming: false });
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
