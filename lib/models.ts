// Claude model registry. Call sites never hard-code model IDs; they read from here.
// Check https://docs.claude.com/en/docs/about-claude/models for current IDs and prices.

export type ModelInfo = {
  id: string;
  label: string;
  /** USD per million tokens. */
  inputPerM: number;
  outputPerM: number;
  /**
   * Request-shape capabilities. These differ per model and a wrong combination is a 400:
   * - Sonnet 5 and Opus 5.5 reject sampling parameters (temperature).
   * - Opus 5.5 rejects forced tool_choice ("tool"/"any") and cannot disable thinking.
   * - Sonnet 5 accepts forced tool_choice only with thinking disabled.
   */
  supportsTemperature: boolean;
  forcedToolChoice: boolean;
  /** "disable" = send thinking {type:"disabled"}; "omit" = send nothing; "adaptive" = cannot be turned off. */
  thinking: "disable" | "omit" | "adaptive";
};

export const MODELS: Record<string, ModelInfo> = {
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    inputPerM: 2,
    outputPerM: 10,
    supportsTemperature: false,
    forcedToolChoice: true,
    thinking: "disable",
  },
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    inputPerM: 4,
    outputPerM: 20,
    supportsTemperature: false,
    forcedToolChoice: false,
    thinking: "adaptive",
  },
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    inputPerM: 1,
    outputPerM: 5,
    supportsTemperature: true,
    forcedToolChoice: true,
    thinking: "omit",
  },
};

export const DRAFT_MODEL_OPTIONS = ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];
export const CHECKER_MODEL_OPTIONS = ["claude-haiku-4-5-20251001", "claude-sonnet-5"];
export const DEFAULT_DRAFT_MODEL = "claude-sonnet-5";
export const DEFAULT_CHECKER_MODEL = "claude-haiku-4-5-20251001";
/** Smallest possible call for "Test connection". */
export const TEST_MODEL = "claude-haiku-4-5-20251001";

export const CREATIVITY = {
  precise: { label: "Precise", temperature: 0.3 },
  balanced: { label: "Balanced", temperature: 0.7 },
  creative: { label: "Creative", temperature: 1.0 },
} as const;
export type Creativity = keyof typeof CREATIVITY;

export function modelInfo(id: string): ModelInfo {
  return (
    MODELS[id] ?? {
      id,
      label: id,
      inputPerM: 4,
      outputPerM: 20,
      supportsTemperature: false,
      forcedToolChoice: false,
      thinking: "adaptive",
    }
  );
}

/** Cost estimate in millionths of a dollar (integer, so it sums exactly). */
export function costMicroUsd(model: string, tokensIn: number, tokensOut: number): number {
  const m = modelInfo(model);
  return Math.round(tokensIn * m.inputPerM + tokensOut * m.outputPerM);
}
