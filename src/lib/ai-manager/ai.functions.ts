import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
});

export const generateAiResponse = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error("Falta LOVABLE_API_KEY en el servidor.");
    }
    const gateway = createLovableAiGatewayProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(data.model ?? "google/gemini-3-flash-preview"),
        prompt: data.prompt,
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
