// Retrieval layer — combines SQL queries and vector search.
import { query, getPool } from "../db/client.js";
import { searchByText } from "./vector.js";
import type { Intent } from "./intent.js";
import { config } from "../config.js";

export interface RetrievedCard {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  color_identity: string;
  colors: string;
  edhrec_rank: number | null;
  rarity: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  tags: string[];
  vectorScore?: number;
}

export interface RetrievedCombo {
  id: string;
  card_names: string[];
  produces: string[];
  description: string | null;
  mana_needed: string | null;
  color_identity: string[];
  popularity: number;
}

export interface RetrievalResult {
  cards: RetrievedCard[];
  combos: RetrievedCombo[];
  hasEmbeddings: boolean;
}

interface RawCard {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  color_identity: string;
  colors: string;
  edhrec_rank: number | null;
  rarity: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
}

interface RawCombo {
  id: string;
  card_names: string;
  produces: string;
  description: string | null;
  mana_needed: string | null;
  color_identity: string;
  popularity: number;
}

function jsonArr(s: string): string[] {
  try { return JSON.parse(s); } catch { return []; }
}

async function attachTags(cards: RawCard[]): Promise<RetrievedCard[]> {
  if (cards.length === 0) return [];
  if (!config.retrieval.enableCardTags) {
    return cards.map((c) => ({ ...c, tags: [] }));
  }
  const ids = cards.map((c) => c.oracle_id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const result = await query<{ oracle_id: string; tag: string }>(
    `SELECT oracle_id, tag FROM card_tags WHERE oracle_id IN (${placeholders})`,
    ids
  );

  const tagMap = new Map<string, string[]>();
  for (const row of result.rows) {
    const existing = tagMap.get(row.oracle_id) ?? [];
    existing.push(row.tag);
    tagMap.set(row.oracle_id, existing);
  }

  return cards.map((c) => ({
    ...c,
    tags: tagMap.get(c.oracle_id) ?? [],
  }));
}

async function hasEmbeddings(): Promise<boolean> {
  if (!config.retrieval.enableVectorSearch) return false;
  const result = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM card_embeddings"
  );
  return result.rows[0].count > 0;
}

function dedupeCards(cards: RetrievedCard[]): RetrievedCard[] {
  const seen = new Map<string, RetrievedCard>();
  for (const card of cards) {
    const existing = seen.get(card.oracle_id);
    if (!existing || (card.vectorScore ?? 0) > (existing.vectorScore ?? 0)) {
      seen.set(card.oracle_id, card);
    }
  }
  return [...seen.values()];
}

function filterByCommanderColors(cards: RetrievedCard[], commanderColors: string[]): RetrievedCard[] {
  if (commanderColors.length === 0 || !config.retrieval.filterByCommanderColor) {
    return cards;
  }
  return cards.filter((card) => {
    const cardColors = jsonArr(card.color_identity);
    if (cardColors.length === 0) return true;
    return cardColors.every((c) => commanderColors.includes(c));
  });
}

function filterByCommanderColorsSql(commanderColors: string[]): string {
  if (commanderColors.length === 0 || !config.retrieval.filterByCommanderColor) {
    return "";
  }
  const colors = commanderColors.map((c) => `'${c}'`).join(",");
  return ` AND (color_identity = '[]' OR color_identity::jsonb <@ '[${colors}]'::jsonb)`;
}

async function retrieveCardLookup(intent: Intent): Promise<RetrievedCard[]> {
  const results: RawCard[] = [];

  for (const name of intent.cardNames) {
    const exact = await query<RawCard>(
      "SELECT * FROM cards WHERE name = $1 LIMIT 1",
      [name]
    );
    if (exact.rows[0]) { results.push(exact.rows[0]); continue; }

    const fuzzy = await query<RawCard>(
      `SELECT * FROM cards WHERE name ILIKE $1 ORDER BY edhrec_rank ASC NULLS LAST LIMIT ${config.retrieval.limits.cardLookup}`,
      [`%${name}%`]
    );
    results.push(...fuzzy.rows);
  }

  if (results.length === 0 && await hasEmbeddings()) {
    return retrieveByVector(intent.searchQuery, config.retrieval.limits.cardLookup);
  }

  const withTags = await attachTags(results);
  return filterByCommanderColors(withTags, intent.commanderColors);
}

async function retrieveDeckBuild(intent: Intent): Promise<{ cards: RetrievedCard[]; combos: RetrievedCombo[] }> {
  let sqlCards: RawCard[] = [];
  let combos: RetrievedCombo[] = [];

  if (intent.commander) {
    const cmd = await query<RawCard>(
      "SELECT * FROM cards WHERE name = $1 LIMIT 1",
      [intent.commander]
    );
    if (cmd.rows[0]) {
      sqlCards.push(cmd.rows[0]);
      const cmdCombos = config.retrieval.enableCombos
        ? await query<RawCombo>(`
          SELECT DISTINCT co.id, co.card_names, co.produces, co.description,
                 co.mana_needed, co.color_identity, co.popularity
          FROM combos co
          JOIN combo_cards cc ON cc.combo_id = co.id
          WHERE cc.oracle_id = $1
          ORDER BY co.popularity DESC
          LIMIT ${config.retrieval.limits.commanderCombos}
        `, [cmd.rows[0].oracle_id])
        : { rows: [] };
      combos = cmdCombos.rows.map((r: RawCombo) => ({
        id: r.id,
        card_names: jsonArr(r.card_names),
        produces: jsonArr(r.produces),
        description: r.description,
        mana_needed: r.mana_needed,
        color_identity: jsonArr(r.color_identity),
        popularity: r.popularity,
      }));
    }
  }

  if (intent.tags.length > 0) {
    const tagPlaceholders = intent.tags.map((_, i) => `$${i + 1}`).join(",");
    const colorFilter = filterByCommanderColorsSql(intent.commanderColors);
    const tagCards = await query<RawCard>(`
      SELECT DISTINCT c.* FROM cards c
      JOIN card_tags ct ON ct.oracle_id = c.oracle_id
      WHERE ct.tag IN (${tagPlaceholders})${colorFilter}
      ORDER BY c.edhrec_rank ASC NULLS LAST
      LIMIT ${config.retrieval.limits.tagCards}
    `, intent.tags);
    sqlCards.push(...tagCards.rows);
  }

  let vectorCards: RetrievedCard[] = [];
  if (await hasEmbeddings()) {
    const q = [
      intent.commander ? `Cards that synergize with ${intent.commander}` : "",
      ...intent.themes,
      intent.searchQuery,
    ].filter(Boolean).join(". ");
    vectorCards = await retrieveByVector(q, config.retrieval.limits.vectorCards);
  }

  const sqlWithTags = await attachTags(sqlCards);
  const merged = dedupeCards([...sqlWithTags, ...vectorCards]);

  merged.sort((a, b) => {
    const scoreDiff = (b.vectorScore ?? 0) - (a.vectorScore ?? 0);
    if (Math.abs(scoreDiff) > 0.02) return scoreDiff;
    return (a.edhrec_rank ?? 999999) - (b.edhrec_rank ?? 999999);
  });

  const filtered = filterByCommanderColors(merged, intent.commanderColors);

  return { cards: filtered.slice(0, config.retrieval.limits.deckBuildMaxCards), combos };
}

async function retrieveComboFind(intent: Intent): Promise<{ cards: RetrievedCard[]; combos: RetrievedCombo[] }> {
  const combos: RetrievedCombo[] = [];
  const relatedCards: RawCard[] = [];

  for (const name of intent.cardNames) {
    const card = await query<{ oracle_id: string }>(
      "SELECT oracle_id FROM cards WHERE name = $1 LIMIT 1",
      [name]
    );

    if (card.rows[0]) {
      const cardData = await query<RawCard>(
        "SELECT * FROM cards WHERE oracle_id = $1",
        [card.rows[0].oracle_id]
      );
      if (cardData.rows[0]) relatedCards.push(cardData.rows[0]);

      const cardCombos = config.retrieval.enableCombos
        ? await query<RawCombo>(`
          SELECT DISTINCT co.id, co.card_names, co.produces, co.description,
                 co.mana_needed, co.color_identity, co.popularity
          FROM combos co
          JOIN combo_cards cc ON cc.combo_id = co.id
          WHERE cc.oracle_id = $1
          ORDER BY co.popularity DESC
          LIMIT ${config.retrieval.limits.comboFindMaxCombos}
        `, [card.rows[0].oracle_id])
        : { rows: [] };

      combos.push(...cardCombos.rows.map((r) => ({
        id: r.id,
        card_names: jsonArr(r.card_names),
        produces: jsonArr(r.produces),
        description: r.description,
        mana_needed: r.mana_needed,
        color_identity: jsonArr(r.color_identity),
        popularity: r.popularity,
      })));
    }
  }

  let vectorCards: RetrievedCard[] = [];
  if (await hasEmbeddings()) {
    vectorCards = await retrieveByVector(intent.searchQuery, config.retrieval.limits.comboFindMaxCombos);
  }

  const merged = dedupeCards([...(await attachTags(relatedCards)), ...vectorCards]);
  return { cards: merged, combos };
}

const TAG_KEYWORDS: Record<string, string[]> = {
  removal: ["destroy target", "exile target", "return target", "-1/-1", "damage to target creature"],
  wipe: ["destroy all", "exile all", "deals damage to all", "each creature gets -"],
  ramp: ["search your library for a", "land card", "add {", "mana to your"],
  draw: ["draw a card", "draw cards", "draw two", "draw three"],
  counter: ["counter target", "counter that", "countered"],
  tutor: ["search your library for a card", "search your library for any card"],
  reanimation: ["return target creature card from your graveyard", "from your graveyard to the battlefield"],
  protection: ["hexproof", "shroud", "indestructible", "protection from"],
  "token-gen": ["create a", "token", "put a", "token onto the battlefield"],
  "combo-piece": ["infinite", "untap all", "untap target", "each time"],
  "win-condition": ["win the game", "loses the game", "damage equal to"],
  stax: ["each player can't", "can't cast", "players can't", "your opponents can't"],
  mill: ["put the top", "cards of your library into your graveyard", "mill"],
  flicker: ["exile target", "return it to the battlefield", "blink"],
  "mana-rock": ["add {", "{t}:", "artifact"],
  "mana-dork": ["{t}: add {", "creature"],
  recursion: ["return target", "from your graveyard"],
  "land-fetch": ["search your library for a", "land", "put it onto the battlefield"],
  "extra-turn": ["take an extra turn", "takes an extra turn"],
  anthem: ["other creatures you control get +", "creatures you control get +"],
  cantrip: ["draw a card"],
};

async function retrieveTagSearchTextFallback(intent: Intent): Promise<RetrievedCard[]> {
  const keywordPhrases: string[] = [];
  for (const tag of intent.tags) {
    const kws = TAG_KEYWORDS[tag] ?? [tag];
    keywordPhrases.push(...kws);
  }
  for (const theme of intent.themes) {
    keywordPhrases.push(theme);
  }

  if (keywordPhrases.length === 0) {
    return (await hasEmbeddings()) ? retrieveByVector(intent.searchQuery, config.retrieval.limits.generalMaxCards) : [];
  }

  const conditions = keywordPhrases.map((_, i) => `LOWER(c.oracle_text) LIKE $${i + 1}`).join(" OR ");
  const params = keywordPhrases.map((kw) => `%${kw.toLowerCase()}%`);

  let sql = `SELECT c.* FROM cards c WHERE (${conditions})`;
  if (intent.budget) sql += " AND c.cmc <= 3";
  sql += ` ORDER BY c.edhrec_rank ASC NULLS LAST LIMIT ${config.retrieval.limits.tagSearchMaxCards}`;

  const rows = await query<RawCard>(sql, params);

  let filtered = rows.rows;
  if (intent.colors.length > 0) {
    const allowed = new Set(intent.colors);
    filtered = rows.rows.filter((c) => {
      const ci = jsonArr(c.color_identity);
      if (ci.length === 0) return true;
      return ci.every((color) => allowed.has(color));
    });
  }

  const result = (await attachTags(filtered.slice(0, config.retrieval.limits.tagSearchMaxCards)));

  if (result.length < 10 && await hasEmbeddings()) {
    const vectorCards = await retrieveByVector(intent.searchQuery, config.retrieval.limits.tagSearchMaxCards);
    return dedupeCards([...result, ...vectorCards]).slice(0, config.retrieval.limits.tagSearchMaxCards);
  }

  return result;
}

async function isTagTableEmpty(): Promise<boolean> {
  const result = await query<{ count: number }>("SELECT COUNT(*) as count FROM card_tags");
  return result.rows[0].count === 0;
}

async function retrieveTagSearch(intent: Intent): Promise<RetrievedCard[]> {
  if (intent.tags.length === 0 && intent.themes.length === 0) {
    return (await hasEmbeddings()) ? retrieveByVector(intent.searchQuery, 20) : [];
  }

  if (await isTagTableEmpty()) {
    return retrieveTagSearchTextFallback(intent);
  }

  const tagPlaceholders = intent.tags.map((_, i) => `$${i + 1}`).join(",");
  const sqlQuery = `
    SELECT DISTINCT c.* FROM cards c
    JOIN card_tags ct ON ct.oracle_id = c.oracle_id
    WHERE ct.tag IN (${tagPlaceholders})
    ORDER BY c.edhrec_rank ASC NULLS LAST LIMIT ${config.retrieval.limits.generalMaxCards}
  `;

  const rows = await query<RawCard>(sqlQuery, intent.tags);

  let filtered = rows.rows;
  if (intent.colors.length > 0) {
    const allowed = new Set(intent.colors);
    filtered = rows.rows.filter((c: RawCard) => {
      const ci = jsonArr(c.color_identity);
      return ci.every((color) => allowed.has(color));
    });
  }

  const result = await attachTags(filtered.slice(0, config.retrieval.limits.tagSearchMaxCards));

  if (result.length < 20 && await hasEmbeddings()) {
    const vectorCards = await retrieveByVector(intent.searchQuery, config.retrieval.limits.tagSearchMaxCards);
    return dedupeCards([...result, ...vectorCards]).slice(0, config.retrieval.limits.tagSearchMaxCards);
  }

  return result;
}

async function retrieveByVector(queryText: string, topK: number): Promise<RetrievedCard[]> {
  const matches = await searchByText(queryText, topK);
  if (matches.length === 0) return [];

  const ids = matches.map((m) => m.oracle_id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const cards = await query<RawCard>(
    `SELECT * FROM cards WHERE oracle_id IN (${placeholders})`,
    ids
  );

  const withTags = await attachTags(cards.rows);

  const scoreMap = new Map(matches.map((m) => [m.oracle_id, m.score]));
  for (const card of withTags) {
    card.vectorScore = scoreMap.get(card.oracle_id);
  }

  withTags.sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0));
  return withTags;
}

export async function retrieve(intent: Intent): Promise<RetrievalResult> {
  const embeds = await hasEmbeddings();

  switch (intent.type) {
    case "card-lookup": {
      const cards = await retrieveCardLookup(intent);
      return { cards, combos: [], hasEmbeddings: embeds };
    }
    case "deck-build": {
      const { cards, combos } = await retrieveDeckBuild(intent);
      return { cards, combos, hasEmbeddings: embeds };
    }
    case "combo-find": {
      const { cards, combos } = await retrieveComboFind(intent);
      return { cards, combos, hasEmbeddings: embeds };
    }
    case "tag-search": {
      const cards = await retrieveTagSearch(intent);
      return { cards, combos: [], hasEmbeddings: embeds };
    }
    case "power-assess": {
      const cards = await retrieveCardLookup(intent);
      const combos: RetrievedCombo[] = [];
      if (config.retrieval.enableCombos) {
        for (const card of cards) {
          const cardCombos = await query<RawCombo>(`
            SELECT DISTINCT co.id, co.card_names, co.produces, co.description,
                   co.mana_needed, co.color_identity, co.popularity
            FROM combos co
            JOIN combo_cards cc ON cc.combo_id = co.id
            WHERE cc.oracle_id = $1
            ORDER BY co.popularity DESC LIMIT ${config.retrieval.limits.powerAssessMaxCards}
          `, [card.oracle_id]);
          combos.push(...cardCombos.rows.map((r: RawCombo) => ({
            id: r.id,
            card_names: jsonArr(r.card_names),
            produces: jsonArr(r.produces),
            description: r.description,
            mana_needed: r.mana_needed,
            color_identity: jsonArr(r.color_identity),
            popularity: r.popularity,
          })));
        }
      }
      return { cards, combos, hasEmbeddings: embeds };
    }
    case "general":
    default: {
      const cards = embeds
        ? await retrieveByVector(intent.searchQuery, config.retrieval.limits.generalMaxCards)
        : [];
      return { cards, combos: [], hasEmbeddings: embeds };
    }
  }
}