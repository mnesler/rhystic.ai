import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IntentConfig {
  enableCommander: boolean;
  enableTags: boolean;
  enableThemes: boolean;
}

export interface RetrievalLimits {
  cardLookup: number;
  commanderCombos: number;
  tagCards: number;
  vectorCards: number;
  deckBuildMaxCards: number;
  comboFindMaxCombos: number;
  tagSearchMaxCards: number;
  generalMaxCards: number;
  powerAssessMaxCards: number;
}

export interface RetrievalConfig {
  enableVectorSearch: boolean;
  enableCombos: boolean;
  enableCardTags: boolean;
  limits: RetrievalLimits;
}

export interface AppConfig {
  intent: IntentConfig;
  retrieval: RetrievalConfig;
}

function loadConfig(): AppConfig {
  const configPath = join(__dirname, "..", "config.json");
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AppConfig;

  return parsed;
}

export const config = loadConfig();
