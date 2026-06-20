import { createServerFn } from "@tanstack/react-start";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
});

async function firecrawlSearch(query: string, limit = 5) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY no configurada.");
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      limit,
      scrapeOptions: { formats: ["markdown"] },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?:
      | Array<{ url?: string; title?: string; description?: string; markdown?: string }>
      | { web?: Array<{ url?: string; title?: string; description?: string; markdown?: string }> };
  };
  const items = Array.isArray(json.data) ? json.data : json.data?.web ?? [];
  return items.slice(0, limit).map((r) => ({
    url: r.url,
    title: r.title,
    description: r.description,
    content: (r.markdown ?? "").slice(0, 4000),
  }));
}

async function firecrawlScrape(url: string) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY no configurada.");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string } };
    markdown?: string;
  };
  const md = json.data?.markdown ?? json.markdown ?? "";
  return { url, content: md.slice(0, 8000) };
}

export const generateAiResponse = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error("Falta LOVABLE_API_KEY en el servidor.");
    }
    const gateway = createLovableAiGatewayProvider(key);
    const today = new Date().toISOString().slice(0, 10);
    const system = `Eres un asistente con acceso a búsqueda web en tiempo real. La fecha de hoy es ${today}. Cuando la consulta pueda depender de información actual, reciente o verificable, USA SIEMPRE la herramienta web_search (y web_scrape para profundizar en una URL). No respondas con datos de entrenamiento si hay riesgo de estar desactualizado. Cita las fuentes (URL) al final cuando uses la web.`;

    try {
      const { text } = await generateText({
        model: gateway(data.model ?? "google/gemini-3-flash-preview"),
        system,
        prompt: data.prompt,
        stopWhen: stepCountIs(50),
        tools: {
          web_search: tool({
            description:
              "Busca en la web en tiempo real. Úsala siempre que se necesite información actual, reciente, en vivo o verificable.",
            inputSchema: z.object({
              query: z.string().describe("Consulta de búsqueda"),
              limit: z.number().int().min(1).max(10).optional(),
            }),
            execute: async ({ query, limit }) => {
              try {
                return { results: await firecrawlSearch(query, limit ?? 5) };
              } catch (e) {
                return { error: e instanceof Error ? e.message : "search_failed" };
              }
            },
          }),
          web_scrape: tool({
            description: "Descarga el contenido principal de una URL en markdown.",
            inputSchema: z.object({ url: z.string().url() }),
            execute: async ({ url }) => {
              try {
                return await firecrawlScrape(url);
              } catch (e) {
                return { error: e instanceof Error ? e.message : "scrape_failed" };
              }
            },
          }),
        },
      });
      return { text };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      const status = e.statusCode ?? e.status;
      if (status === 429) {
        throw new Error("Límite de peticiones alcanzado. Inténtalo en unos segundos.");
      }
      if (status === 402) {
        throw new Error("Sin créditos de IA. Añade créditos en el workspace para continuar.");
      }
      throw new Error(e.message ?? "Error al llamar a la IA.");
    }
  });
