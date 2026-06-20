import { createServerFn } from "@tanstack/react-start";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
});

type SearchOpts = {
  query: string;
  limit?: number;
  tbs?: string;
  lang?: string;
  country?: string;
  scrape?: boolean;
};

async function firecrawlSearch(opts: SearchOpts) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY no configurada.");
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: opts.limit ?? 5,
  };
  if (opts.tbs) body.tbs = opts.tbs;
  if (opts.lang) body.lang = opts.lang;
  if (opts.country) body.country = opts.country;
  if (opts.scrape !== false) {
    body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  }
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
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
  return items.slice(0, opts.limit ?? 5).map((r) => ({
    url: r.url,
    title: r.title,
    description: r.description,
    content: (r.markdown ?? "").slice(0, 4000),
  }));
}

async function firecrawlScrape(url: string, waitFor?: number) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY no configurada.");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 0, // fuerza fetch en vivo, evita caché
      waitFor: waitFor ?? 0,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } };
    markdown?: string;
  };
  const md = json.data?.markdown ?? json.markdown ?? "";
  return {
    url: json.data?.metadata?.sourceURL ?? url,
    title: json.data?.metadata?.title,
    content: md.slice(0, 12000),
  };
}

async function firecrawlMap(url: string, search?: string, limit = 50) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY no configurada.");
  const body: Record<string, unknown> = { url, limit, includeSubdomains: false };
  if (search) body.search = search;
  const res = await fetch("https://api.firecrawl.dev/v2/map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl map ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { links?: string[]; data?: { links?: string[] } };
  return { links: (json.links ?? json.data?.links ?? []).slice(0, limit) };
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
    const system = `Eres un asistente con acceso a búsqueda web en tiempo real. Hoy es ${today}.

REGLAS DE BÚSQUEDA (obligatorias):
1. Para cualquier información actual, reciente o verificable usa SIEMPRE las herramientas web.
2. Si el usuario nombra un portal concreto (BOE, subastas BOE, BORME, AEAT, INE, registros oficiales, sedes electrónicas, marketplaces, etc.) NO uses búsqueda genérica de Google sola. Sigue este protocolo:
   a) Identifica el dominio oficial (p. ej. subastas.boe.es, www.boe.es).
   b) Usa web_search con "site:dominio" + términos del usuario y tbs="qdr:w" o "qdr:d" si la consulta implica novedades.
   c) Usa web_map sobre el dominio con un "search" relevante para descubrir páginas reales (listados, fichas).
   d) Para cada URL prometedora usa web_scrape (fuerza datos en vivo, sin caché) y extrae los campos pedidos.
   e) Si una página requiere filtros (formulario GET), construye tú la URL con los parámetros en la query string y haz scrape directo de la URL resultante. Ejemplo BOE subastas: https://subastas.boe.es/subastas_ava.php?campo[...]=...
3. Nunca inventes resultados ni respondas con datos de entrenamiento si la consulta puede haber cambiado. Si tras buscar no encuentras información válida, dilo explícitamente y muestra qué URLs intentaste.
4. Cita SIEMPRE las URLs reales consultadas al final, en una sección "Fuentes".
5. Idioma de la respuesta: el del usuario (por defecto español).`;

    try {
      const { text } = await generateText({
        model: gateway(data.model ?? "google/gemini-3-flash-preview"),
        system,
        prompt: data.prompt,
        stopWhen: stepCountIs(50),
        tools: {
          web_search: tool({
            description:
              "Busca en la web en tiempo real (Google). Acepta operadores como site:, comillas y -excluir. Usa tbs para filtrar por tiempo: qdr:h (hora), qdr:d (día), qdr:w (semana), qdr:m (mes), qdr:y (año).",
            inputSchema: z.object({
              query: z.string().describe("Consulta. Usa site:dominio para acotar a un portal."),
              limit: z.number().int().min(1).max(10).optional(),
              tbs: z.string().optional().describe("Filtro temporal: qdr:h|d|w|m|y"),
              lang: z.string().optional().describe("Idioma, p. ej. 'es'"),
              country: z.string().optional().describe("País, p. ej. 'es'"),
            }),
            execute: async ({ query, limit, tbs, lang, country }) => {
              try {
                return {
                  results: await firecrawlSearch({ query, limit, tbs, lang, country }),
                };
              } catch (e) {
                return { error: e instanceof Error ? e.message : "search_failed" };
              }
            },
          }),
          web_scrape: tool({
            description:
              "Descarga el contenido principal de una URL concreta en markdown, en vivo (sin caché). Úsala para portales con filtros: construye la URL con los parámetros del formulario en la query string y pásala aquí.",
            inputSchema: z.object({
              url: z.string().url(),
              waitFor: z
                .number()
                .int()
                .min(0)
                .max(15000)
                .optional()
                .describe("Milisegundos para esperar a contenido dinámico"),
            }),
            execute: async ({ url, waitFor }) => {
              try {
                return await firecrawlScrape(url, waitFor);
              } catch (e) {
                return { error: e instanceof Error ? e.message : "scrape_failed" };
              }
            },
          }),
          web_map: tool({
            description:
              "Descubre URLs reales dentro de un dominio (sitemap rápido). Útil para localizar páginas de listado o fichas en portales oficiales antes de hacer scrape.",
            inputSchema: z.object({
              url: z.string().url().describe("Dominio raíz, p. ej. https://subastas.boe.es"),
              search: z.string().optional().describe("Filtra los enlaces por palabra clave"),
              limit: z.number().int().min(1).max(200).optional(),
            }),
            execute: async ({ url, search, limit }) => {
              try {
                return await firecrawlMap(url, search, limit ?? 50);
              } catch (e) {
                return { error: e instanceof Error ? e.message : "map_failed" };
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
