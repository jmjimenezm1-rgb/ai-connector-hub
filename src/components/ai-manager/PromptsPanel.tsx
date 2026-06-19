import { useState } from "react";
import { Plus, Pencil, Trash2, Play, ArrowLeft, Loader2, Sparkles, Save } from "lucide-react";
import { useAIManager, type PromptTemplate } from "@/lib/ai-manager/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PromptsPanel() {
  const { prompts, upsertPrompt, deletePrompt } = useAIManager();
  const [editing, setEditing] = useState<PromptTemplate | "new" | null>(null);

  if (editing) {
    return (
      <PromptEditor
        prompt={editing === "new" ? null : editing}
        onBack={() => setEditing(null)}
        onSave={async (data) => {
          await upsertPrompt(data);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Gestor de prompts</h2>
          <p className="text-sm text-muted-foreground">Crea, edita y prueba prompts en el playground.</p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Nuevo
        </Button>
      </header>

      <div className="space-y-2">
        {prompts.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Aún no hay prompts. Crea el primero.
          </div>
        )}
        {prompts.map((p) => (
          <article
            key={p.id}
            className="group rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold">{p.title}</h3>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                    {p.module}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(p)} aria-label="Editar">
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deletePrompt(p.id)}
                  aria-label="Eliminar"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PromptEditor({
  prompt,
  onBack,
  onSave,
}: {
  prompt: PromptTemplate | null;
  onBack: () => void;
  onSave: (data: { id?: string; title: string; module: string; body: string }) => void | Promise<void>;
}) {
  const { runQuery } = useAIManager();
  const [title, setTitle] = useState(prompt?.title ?? "");
  const [module, setModule] = useState(prompt?.module ?? "General");
  const [body, setBody] = useState(prompt?.body ?? "Eres un asistente útil.\n\n{{input}}");
  const [testInput, setTestInput] = useState("Ejemplo de entrada de prueba");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  const runTest = async () => {
    setRunning(true);
    setOutput(null);
    const filled = body.replace(/\{\{\s*input\s*\}\}/g, testInput);
    const res = await runQuery({ module: `Playground · ${title || "sin título"}`, prompt: filled });
    setOutput(res.response);
    setRunning(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> Volver
        </Button>
        <Button
          size="sm"
          onClick={() => onSave({ id: prompt?.id, title: title.trim() || "Sin título", module: module.trim() || "General", body })}
        >
          <Save className="size-3.5" /> Guardar
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <h3 className="text-sm font-semibold">Editor</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t">Título</Label>
              <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Resumen ejecutivo" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m">Módulo</Label>
              <Input id="m" value={module} onChange={(e) => setModule(e.target.value)} placeholder="Ej. CRM" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b">Cuerpo del prompt</Label>
            <Textarea
              id="b"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="resize-none font-mono text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Usa <code className="rounded bg-muted px-1 py-0.5 font-mono">{"{{input}}"}</code> como variable de entrada.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Playground</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
              <Sparkles className="size-3" /> Pruebas en vivo
            </span>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ti">Entrada de prueba</Label>
            <Textarea
              id="ti"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              rows={4}
              className="resize-none"
              placeholder="Sustituye {{input}} del prompt"
            />
          </div>
          <Button onClick={runTest} disabled={running} className="w-full">
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {running ? "Ejecutando..." : "Ejecutar prompt"}
          </Button>

          <div className="rounded-xl border bg-[color:var(--surface)] p-3 min-h-32">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Respuesta de la IA</div>
            {running ? (
              <div className="space-y-2">
                <div className="h-3 w-11/12 rounded shimmer" />
                <div className="h-3 w-8/12 rounded shimmer" />
                <div className="h-3 w-10/12 rounded shimmer" />
              </div>
            ) : output ? (
              <p className="text-sm leading-relaxed">{output}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ajusta el prompt y ejecuta para validar la respuesta.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
