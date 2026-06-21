import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateAiResponse } from "./ai.functions";

export type AIProviderId = "chatgpt" | "claude" | "gemini" | "copilot" | "firecrawl";
export type ConnectionStatus = "active" | "pending" | "disconnected";

export interface AIProvider {
  id: AIProviderId;
  name: string;
  tagline: string;
  accent: string;
  kind?: "llm" | "search";
}

export const AI_PROVIDERS: AIProvider[] = [
  { id: "chatgpt", name: "ChatGPT", tagline: "OpenAI · GPT-4o", accent: "oklch(0.72 0.15 155)", kind: "llm" },
  { id: "claude", name: "Claude", tagline: "Anthropic · Sonnet", accent: "oklch(0.7 0.17 50)", kind: "llm" },
  { id: "gemini", name: "Gemini", tagline: "Google · 1.5 Pro", accent: "oklch(0.65 0.18 250)", kind: "llm" },
  { id: "copilot", name: "Copilot", tagline: "Microsoft · GPT-4", accent: "oklch(0.7 0.15 200)", kind: "llm" },
  { id: "firecrawl", name: "Firecrawl", tagline: "Búsqueda y scraping web en vivo", accent: "oklch(0.7 0.2 35)", kind: "search" },
];

export interface Connection {
  providerId: AIProviderId;
  status: ConnectionStatus;
  account: string;
  tokenMask: string;
  connectedAt: string;
}

export interface QueryRecord {
  id: string;
  module: string;
  providerId: AIProviderId;
  prompt: string;
  response: string;
  status: "success" | "error" | "pending";
  durationMs: number;
  createdAt: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  module: string;
  body: string;
  updatedAt: string;
}

interface RunModuleInput {
  module: string;
  input: string;
  fallbackPrompt?: string;
  external?: boolean;
  providerId?: AIProviderId;
  /** Optional extra named params replaced as {{name}} */
  params?: Record<string, string>;
}

interface RunModuleResult extends QueryRecord {
  registered: boolean;
  promptId: string;
}

interface Ctx {
  connections: Connection[];
  activeProvider: AIProviderId | null;
  history: QueryRecord[];
  prompts: PromptTemplate[];
  loading: boolean;
  connect: (providerId: AIProviderId, account: string, token: string) => Promise<void>;
  disconnect: (providerId: AIProviderId) => Promise<void>;
  setActiveProvider: (id: AIProviderId | null) => void;
  runQuery: (input: { module: string; prompt: string; providerId?: AIProviderId }) => Promise<QueryRecord>;
  runModule: (input: RunModuleInput) => Promise<RunModuleResult>;
  upsertPrompt: (p: Omit<PromptTemplate, "id" | "updatedAt"> & { id?: string }) => Promise<PromptTemplate>;
  deletePrompt: (id: string) => Promise<void>;
  getPromptByModule: (module: string) => PromptTemplate | undefined;
}

const HISTORY_KEY = "ai-manager-history-v1";
const ACTIVE_KEY = "ai-manager-active-v1";

const AIContext = createContext<Ctx | null>(null);

function mask(token: string) {
  return token.length > 6 ? `${token.slice(0, 3)}••••${token.slice(-4)}` : "••••••";
}

export function AIManagerProvider({ children }: { children: ReactNode }) {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [history, setHistory] = useState<QueryRecord[]>([]);
  const [activeProvider, setActiveProviderState] = useState<AIProviderId | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const h = localStorage.getItem(HISTORY_KEY);
        if (h) setHistory(JSON.parse(h));
        const a = localStorage.getItem(ACTIVE_KEY);
        if (a) setActiveProviderState(a as AIProviderId);
      } catch { /* ignore */ }
    }
    (async () => {
      const [pRes, cRes] = await Promise.all([
        supabase.from("ai_prompts").select("*").order("updated_at", { ascending: false }),
        supabase.from("ai_connections").select("*"),
      ]);
      if (pRes.data) {
        setPrompts(pRes.data.map((r) => ({
          id: r.id, title: r.title, module: r.module, body: r.body, updatedAt: r.updated_at,
        })));
      }
      if (cRes.data) {
        setConnections(cRes.data.map((r) => ({
          providerId: r.provider_id as AIProviderId,
          status: r.status as ConnectionStatus,
          account: r.account,
          tokenMask: mask(r.api_key),
          connectedAt: r.connected_at,
        })));
      }
      setLoading(false);
    })();
  }, []);

  // Persist history + active provider
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  }, [history]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (activeProvider) localStorage.setItem(ACTIVE_KEY, activeProvider);
      else localStorage.removeItem(ACTIVE_KEY);
    }
  }, [activeProvider]);

  const setActiveProvider = useCallback((id: AIProviderId | null) => setActiveProviderState(id), []);

  const connect = useCallback(async (providerId: AIProviderId, account: string, token: string) => {
    const { error } = await supabase.from("ai_connections").upsert({
      provider_id: providerId,
      account,
      api_key: token,
      status: "active",
      connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    setConnections((cs) => {
      const others = cs.filter((c) => c.providerId !== providerId);
      return [...others, {
        providerId, status: "active", account, tokenMask: mask(token), connectedAt: new Date().toISOString(),
      }];
    });
    setActiveProviderState(providerId);
  }, []);

  const disconnect = useCallback(async (providerId: AIProviderId) => {
    const { error } = await supabase.from("ai_connections").delete().eq("provider_id", providerId);
    if (error) throw error;
    setConnections((cs) => cs.filter((c) => c.providerId !== providerId));
    setActiveProviderState((cur) => (cur === providerId ? null : cur));
  }, []);

  const runQuery = useCallback<Ctx["runQuery"]>(async ({ module, prompt, providerId }) => {
    const id = `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const provider = providerId ?? activeProvider ?? "chatgpt";
    const pending: QueryRecord = {
      id, module, providerId: provider, prompt, response: "", status: "pending",
      durationMs: 0, createdAt: new Date().toISOString(),
    };
    setHistory((h) => [pending, ...h].slice(0, 50));

    const start = Date.now();
    let response = "";
    let status: QueryRecord["status"] = "success";
    try {
      const { text } = await generateAiResponse({ data: { prompt } });
      response = text;
    } catch (err) {
      status = "error";
      response = err instanceof Error ? err.message : "Error desconocido al consultar la IA.";
    }
    const finished: QueryRecord = { ...pending, response, status, durationMs: Date.now() - start };
    setHistory((h) => h.map((x) => (x.id === id ? finished : x)));
    return finished;
  }, [activeProvider]);

  const upsertPrompt = useCallback<Ctx["upsertPrompt"]>(async (p) => {
    if (p.id) {
      const { data, error } = await supabase
        .from("ai_prompts")
        .update({ title: p.title, module: p.module, body: p.body })
        .eq("id", p.id)
        .select()
        .single();
      if (error) throw error;
      const next: PromptTemplate = {
        id: data.id, title: data.title, module: data.module, body: data.body, updatedAt: data.updated_at,
      };
      setPrompts((ps) => ps.map((x) => (x.id === next.id ? next : x)));
      return next;
    }
    const { data, error } = await supabase
      .from("ai_prompts")
      .insert({ title: p.title, module: p.module, body: p.body })
      .select()
      .single();
    if (error) throw error;
    const next: PromptTemplate = {
      id: data.id, title: data.title, module: data.module, body: data.body, updatedAt: data.updated_at,
    };
    setPrompts((ps) => [next, ...ps]);
    return next;
  }, []);

  const deletePrompt = useCallback(async (id: string) => {
    const { error } = await supabase.from("ai_prompts").delete().eq("id", id);
    if (error) throw error;
    setPrompts((ps) => ps.filter((p) => p.id !== id));
  }, []);

  const getPromptByModule = useCallback<Ctx["getPromptByModule"]>(
    (mod) => prompts.find((p) => p.module.toLowerCase() === mod.toLowerCase()),
    [prompts],
  );

  const runModule = useCallback<Ctx["runModule"]>(
    async ({ module, input, fallbackPrompt, external, providerId, params }) => {
      const existing = prompts.find((p) => p.module.toLowerCase() === module.toLowerCase());
      let promptTemplate: PromptTemplate;
      let registered = false;

      if (existing) {
        promptTemplate = existing;
      } else {
        const body = fallbackPrompt && fallbackPrompt.trim() ? fallbackPrompt : "{{input}}";
        promptTemplate = await upsertPrompt({
          title: `Auto · ${module}`,
          module,
          body,
        });
        registered = true;
      }

      const hasInputPlaceholder = /\{\{\s*input\s*\}\}/.test(promptTemplate.body);
      let filled = promptTemplate.body.replace(/\{\{\s*input\s*\}\}/g, input ?? "");
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          filled = filled.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), v);
        }
      }
      // If the template has no {{input}} placeholder, append the user's input
      // as the actual data to process so the IA ejecuta la consulta en vez de
      // pedir de nuevo los parámetros.
      if (!hasInputPlaceholder && input && input.trim()) {
        filled = `${filled}\n\n---\nDatos de entrada proporcionados por el usuario (úsalos directamente, NO vuelvas a pedirlos):\n${input}\n\nEjecuta ahora la consulta completa y devuelve el resultado final solicitado.`;
      }
      const tag = external ? "Externa" : "Prueba";
      const record = await runQuery({
        module: `${tag} · ${module}`,
        prompt: filled,
        providerId,
      });
      return { ...record, registered, promptId: promptTemplate.id };
    },
    [prompts, runQuery, upsertPrompt],
  );

  const value = useMemo<Ctx>(
    () => ({
      connections, activeProvider, history, prompts, loading,
      connect, disconnect, setActiveProvider, runQuery, runModule,
      upsertPrompt, deletePrompt, getPromptByModule,
    }),
    [connections, activeProvider, history, prompts, loading, connect, disconnect, setActiveProvider, runQuery, runModule, upsertPrompt, deletePrompt, getPromptByModule],
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAIManager() {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error("useAIManager must be used within AIManagerProvider");
  return ctx;
}

export function getProvider(id: AIProviderId) {
  return AI_PROVIDERS.find((p) => p.id === id)!;
}
