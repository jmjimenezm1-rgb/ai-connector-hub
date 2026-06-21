import type { AIProviderId } from "@/lib/ai-manager/store";

interface Props {
  id: AIProviderId;
  className?: string;
  size?: number;
}

export function ProviderIcon({ id, className, size = 24 }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 32 32",
    fill: "none",
    className,
  } as const;
  switch (id) {
    case "chatgpt":
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="14" fill="oklch(0.72 0.15 155)" />
          <path d="M16 8l5.5 3.2v6.4L16 20.8 10.5 17.6v-6.4L16 8z" fill="white" opacity="0.95" />
          <path d="M16 8v12.8M10.5 11.2L21.5 17.6M21.5 11.2L10.5 17.6" stroke="oklch(0.72 0.15 155)" strokeWidth="1.2" />
        </svg>
      );
    case "claude":
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="14" fill="oklch(0.7 0.17 50)" />
          <path d="M11 22l3.2-12h1.8l-3.2 12H11zm6 0l3.2-12H22l-3.2 12H17z" fill="white" />
        </svg>
      );
    case "gemini":
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="14" fill="oklch(0.65 0.18 250)" />
          <path d="M16 7l2.2 5.8L24 15l-5.8 2.2L16 23l-2.2-5.8L8 15l5.8-2.2L16 7z" fill="white" />
        </svg>
      );
    case "copilot":
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="14" fill="oklch(0.7 0.15 200)" />
          <path d="M9 18c0-3 2-5 5-5h4c3 0 5 2 5 5v1c0 2-1.5 3-3.5 3h-7C10.5 22 9 21 9 19v-1z" fill="white" />
          <circle cx="13" cy="17.5" r="1.2" fill="oklch(0.7 0.15 200)" />
          <circle cx="19" cy="17.5" r="1.2" fill="oklch(0.7 0.15 200)" />
        </svg>
      );
    case "firecrawl":
      return (
        <svg {...common}>
          <rect width="32" height="32" rx="14" fill="oklch(0.7 0.2 35)" />
          <path d="M16 6c1 3 4 4 4 8a4 4 0 01-8 0c0-2 1-3 2-4-1 4 2 4 2 1 0-2 0-3 0-5z" fill="white" />
          <path d="M11 22h10v2H11z" fill="white" opacity="0.85" />
        </svg>
      );
  }
}
