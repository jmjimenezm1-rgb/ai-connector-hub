import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Cpu, Link2, MessageSquareText, Sparkles } from "lucide-react";
import { AIManagerProvider } from "@/lib/ai-manager/store";
import { ConnectionsPanel } from "@/components/ai-manager/ConnectionsPanel";
import { QueryEnginePanel } from "@/components/ai-manager/QueryEnginePanel";
import { PromptsPanel } from "@/components/ai-manager/PromptsPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Connection Manager" },
      { name: "description", content: "Gestor central de conexiones, consultas y prompts para tus plataformas de IA." },
      { property: "og:title", content: "AI Connection Manager" },
      { property: "og:description", content: "Conecta ChatGPT, Claude, Gemini y Copilot. Orquesta consultas y administra prompts." },
    ],
  }),
  component: Index,
});

type Tab = "connections" | "engine" | "prompts";

const TABS: { id: Tab; label: string; icon: typeof Link2 }[] = [
  { id: "connections", label: "Conexiones", icon: Link2 },
  { id: "engine", label: "Motor", icon: Cpu },
  { id: "prompts", label: "Prompts", icon: MessageSquareText },
];

function Index() {
  const [tab, setTab] = useState<Tab>("connections");

  return (
    <AIManagerProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:py-4">
            <div className="flex items-center gap-2.5">
              <div
                className="grid size-9 place-items-center rounded-xl text-primary-foreground"
                style={{ background: "var(--gradient-primary)" }}
              >
                <Sparkles className="size-4.5" />
              </div>
              <div>
                <h1 className="text-sm font-semibold leading-tight sm:text-base">AI Connection Manager</h1>
                <p className="text-[11px] text-muted-foreground">Conecta · Consulta · Itera</p>
              </div>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">v1.0 · demo</span>
          </div>

          <nav className="mx-auto max-w-5xl px-4 pb-3">
            <div className="inline-flex w-full rounded-xl bg-muted p-1 sm:w-auto">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:flex-none sm:px-4 sm:text-sm ${
                    tab === id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 pb-20">
          {tab === "connections" && <ConnectionsPanel />}
          {tab === "engine" && <QueryEnginePanel />}
          {tab === "prompts" && <PromptsPanel />}
        </main>
      </div>
    </AIManagerProvider>
  );
}
