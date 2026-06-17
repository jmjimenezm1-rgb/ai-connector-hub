import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AIProviderId = "chatgpt" | "claude" | "gemini" | "copilot";
export type ConnectionStatus = "active" | "pending" | "disconnected";

export interface AIProvider {
  id: AIProviderId;
  name: string;
  tagline: string;
  accent: string;
}

export const AI_PROVIDERS: AIProvider[] = [
  { id: "chatgpt", name: "ChatGPT", tagline: "OpenAI · GPT-4o", accent: "oklch(0.72 0.15 155)" },
  { id: "claude", name: "Claude", tagline: "Anthropic · Sonnet", accent: "oklch(0.7 0.17 50)" },
  { id: "gemini", name: "Gemini", tagline: "Google · 1.5 Pro", accent: "oklch(0.65 0.18 250)" },
  { id: "copilot", name: "Copilot", tagline: "Microsoft · GPT-4", accent: "oklch(0.7 0.15 200)" },
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

interface State {
  connections: Connection[];
  activeProvider: AIProviderId | null;
  history: QueryRecord[];
  prompts: PromptTemplate[];
}

interface RunModuleInput {
  module: string;
  input: string;
  /** Prompt body to register if the module is not yet registered. May include {{input}}. */
  fallbackPrompt?: string;
  /** If true, simulates an external call (real mode). Otherwise, test mode. */
  external?: boolean;
  providerId?: AIProviderId;
}

interface RunModuleResult extends QueryRecord {
  registered: boolean;
  promptId: string;
}

interface Ctx extends State {
  connect: (providerId: AIProviderId, account: string, token: string) => void;
  disconnect: (providerId: AIProviderId) => void;
  setActiveProvider: (id: AIProviderId | null) => void;
  runQuery: (input: { module: string; prompt: string; providerId?: AIProviderId }) => Promise<QueryRecord>;
  runModule: (input: RunModuleInput) => Promise<RunModuleResult>;
  upsertPrompt: (p: Omit<PromptTemplate, "id" | "updatedAt"> & { id?: string }) => PromptTemplate;
  deletePrompt: (id: string) => void;
  getPromptByModule: (module: string) => PromptTemplate | undefined;
}

const STORAGE_KEY = "ai-manager-state-v1";

const DEFAULTS: State = {
  connections: [
    { providerId: "chatgpt", status: "active", account: "demo@user.io", tokenMask: "sk-••••a91f", connectedAt: new Date().toISOString() },
    { providerId: "claude", status: "pending", account: "demo@user.io", tokenMask: "sk-••••3c2b", connectedAt: new Date().toISOString() },
  ],
  activeProvider: "chatgpt",
  history: [
    { id: "h1", module: "Resumen Documental", providerId: "chatgpt", prompt: "Resume el reporte trimestral", response: "El Q3 muestra un crecimiento del 12%...", status: "success", durationMs: 980, createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString() },
    { id: "h2", module: "Análisis de Datos", providerId: "chatgpt", prompt: "Detecta anomalías en ventas", response: "Se identificaron 3 outliers en la región norte.", status: "success", durationMs: 1340, createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString() },
  ],
  prompts: [
    { id: "p1", title: "Prompt para Resumen", module: "Resumen Documental", body: "Eres un asistente experto en sintetizar documentos. Resume el siguiente contenido en 5 puntos clave manteniendo el tono profesional:\n\n{{input}}", updatedAt: new Date().toISOString() },
    { id: "p2", title: "Análisis de Datos", module: "Analítica", body: "Analiza los siguientes datos y entrega: 1) Insights principales, 2) Anomalías, 3) Recomendaciones accionables.\n\nDatos:\n{{input}}", updatedAt: new Date().toISOString() },
    { id: "p3", title: "Generador de Emails", module: "CRM", body: "Redacta un email cordial y conciso al cliente con el siguiente contexto:\n\n{{input}}", updatedAt: new Date().toISOString() },
  ],
};

const AIContext = createContext<Ctx | null>(null);

function load(): State {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

const MOCK_RESPONSES = [
  "Aquí tienes una respuesta sintetizada con los puntos clave que solicitaste, organizada de forma clara y accionable.",
  "He procesado la información. Los insights principales sugieren tres oportunidades de mejora prioritarias.",
  "Análisis completado. La tendencia indica un comportamiento positivo con margen de optimización en dos áreas.",
  "Listo. Generé una versión refinada que mantiene tu intención original con mayor claridad expresiva.",
];

export function AIManagerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => load());

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [state]);

  const connect = useCallback((providerId: AIProviderId, account: string, token: string) => {
    setState((s) => {
      const tokenMask = token.length > 6 ? `${token.slice(0, 3)}••••${token.slice(-4)}` : "••••••";
      const others = s.connections.filter((c) => c.providerId !== providerId);
      return {
        ...s,
        connections: [
          ...others,
          { providerId, status: "active", account, tokenMask, connectedAt: new Date().toISOString() },
        ],
        activeProvider: providerId,
      };
    });
  }, []);

  const disconnect = useCallback((providerId: AIProviderId) => {
    setState((s) => ({
      ...s,
      connections: s.connections.map((c) =>
        c.providerId === providerId ? { ...c, status: "disconnected" } : c,
      ),
      activeProvider: s.activeProvider === providerId ? null : s.activeProvider,
    }));
  }, []);

  const setActiveProvider = useCallback((id: AIProviderId | null) => {
    setState((s) => ({ ...s, activeProvider: id }));
  }, []);

  const runQuery = useCallback<Ctx["runQuery"]>(async ({ module, prompt, providerId }) => {
    const id = `q_${Date.now()}`;
    const provider = providerId ?? state.activeProvider ?? "chatgpt";
    const pending: QueryRecord = {
      id,
      module,
      providerId: provider,
      prompt,
      response: "",
      status: "pending",
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, history: [pending, ...s.history].slice(0, 50) }));

    const start = Date.now();
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 900));
    const response = MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
    const finished: QueryRecord = {
      ...pending,
      response,
      status: "success",
      durationMs: Date.now() - start,
    };
    setState((s) => ({
      ...s,
      history: s.history.map((h) => (h.id === id ? finished : h)),
    }));
    return finished;
  }, [state.activeProvider]);

  const upsertPrompt = useCallback<Ctx["upsertPrompt"]>((p) => {
    const now = new Date().toISOString();
    const id = p.id ?? `p_${Date.now()}`;
    const next: PromptTemplate = { id, title: p.title, module: p.module, body: p.body, updatedAt: now };
    setState((s) => {
      const exists = s.prompts.some((x) => x.id === id);
      return {
        ...s,
        prompts: exists ? s.prompts.map((x) => (x.id === id ? next : x)) : [next, ...s.prompts],
      };
    });
    return next;
  }, []);

  const deletePrompt = useCallback((id: string) => {
    setState((s) => ({ ...s, prompts: s.prompts.filter((p) => p.id !== id) }));
  }, []);

  const value = useMemo<Ctx>(
    () => ({ ...state, connect, disconnect, setActiveProvider, runQuery, upsertPrompt, deletePrompt }),
    [state, connect, disconnect, setActiveProvider, runQuery, upsertPrompt, deletePrompt],
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
