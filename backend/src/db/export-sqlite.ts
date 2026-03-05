import Database from "better-sqlite3";
import { writeFileSync } from "fs";

const sqlitePath = "./data/mtg.db";

interface SqliteCard {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  colors: string;
  color_identity: string;
  keywords: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  produced_mana: string | null;
  edhrec_rank: number | null;
  rarity: string | null;
  set_code: string | null;
}

interface SqliteTag {
  oracle_id: string;
  tag: string;
}

interface SqliteCombo {
  id: string;
  card_names: string;
  produces: string;
  description: string | null;
  mana_needed: string | null;
  color_identity: string;
  popularity: number;
  bracket_tag: string | null;
}

interface SqliteComboCard {
  combo_id: string;
  card_name: string;
  oracle_id: string | null;
}

function escape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function exportToSql() {
  console.log("Opening SQLite...");
  const sqlite = new Database(sqlitePath);
  
  const sql: string[] = [];
  
  // Migrate cards
  console.log("Exporting cards...");
  const cards = sqlite.prepare("SELECT * FROM cards").all() as SqliteCard[];
  console.log(`  Found ${cards.length} cards`);
  
  for (const card of cards) {
    sql.push(`INSERT INTO cards (oracle_id, name, mana_cost, cmc, type_line, oracle_text, colors, color_identity, keywords, power, toughness, loyalty, produced_mana, edhrec_rank, rarity, set_code) VALUES (${escape(card.oracle_id)}, ${escape(card.name)}, ${escape(card.mana_cost)}, ${escape(card.cmc)}, ${escape(card.type_line)}, ${escape(card.oracle_text)}, ${escape(card.colors)}, ${escape(card.color_identity)}, ${escape(card.keywords)}, ${escape(card.power)}, ${escape(card.toughness)}, ${escape(card.loyalty)}, ${escape(card.produced_mana)}, ${escape(card.edhrec_rank)}, ${escape(card.rarity)}, ${escape(card.set_code)}) ON CONFLICT (oracle_id) DO UPDATE SET name = EXCLUDED.name, mana_cost = EXCLUDED.mana_cost, cmc = EXCLUDED.cmc, type_line = EXCLUDED.type_line, oracle_text = EXCLUDED.oracle_text, colors = EXCLUDED.colors, color_identity = EXCLUDED.color_identity, keywords = EXCLUDED.keywords, power = EXCLUDED.power, toughness = EXCLUDED.toughness, loyalty = EXCLUDED.loyalty, produced_mana = EXCLUDED.produced_mana, edhrec_rank = EXCLUDED.edhrec_rank, rarity = EXCLUDED.rarity, set_code = EXCLUDED.set_code;`);
  }
  console.log(`  Generated ${cards.length} card inserts`);
  
  // Export card_tags
  console.log("Exporting card_tags...");
  const tags = sqlite.prepare("SELECT * FROM card_tags").all() as SqliteTag[];
  console.log(`  Found ${tags.length} tags`);
  
  for (const tag of tags) {
    sql.push(`INSERT INTO card_tags (oracle_id, tag) VALUES (${escape(tag.oracle_id)}, ${escape(tag.tag)}) ON CONFLICT DO NOTHING;`);
  }
  console.log(`  Generated ${tags.length} tag inserts`);
  
  // Export combos
  console.log("Exporting combos...");
  const combos = sqlite.prepare("SELECT * FROM combos").all() as SqliteCombo[];
  console.log(`  Found ${combos.length} combos`);
  
  for (const combo of combos) {
    sql.push(`INSERT INTO combos (id, card_names, produces, description, mana_needed, color_identity, popularity, bracket_tag) VALUES (${escape(combo.id)}, ${escape(combo.card_names)}, ${escape(combo.produces)}, ${escape(combo.description)}, ${escape(combo.mana_needed)}, ${escape(combo.color_identity)}, ${escape(combo.popularity)}, ${escape(combo.bracket_tag)}) ON CONFLICT (id) DO UPDATE SET card_names = EXCLUDED.card_names, produces = EXCLUDED.produces, description = EXCLUDED.description, mana_needed = EXCLUDED.mana_needed, color_identity = EXCLUDED.color_identity, popularity = EXCLUDED.popularity, bracket_tag = EXCLUDED.bracket_tag;`);
  }
  console.log(`  Generated ${combos.length} combo inserts`);
  
  // Export combo_cards
  console.log("Exporting combo_cards...");
  const comboCards = sqlite.prepare("SELECT * FROM combo_cards").all() as SqliteComboCard[];
  console.log(`  Found ${comboCards.length} combo_cards`);
  
  for (const cc of comboCards) {
    sql.push(`INSERT INTO combo_cards (combo_id, card_name, oracle_id) VALUES (${escape(cc.combo_id)}, ${escape(cc.card_name)}, ${escape(cc.oracle_id)}) ON CONFLICT DO NOTHING;`);
  }
  console.log(`  Generated ${comboCards.length} combo_card inserts`);
  
  sqlite.close();
  
  const output = sql.join("\n");
  writeFileSync("./data/migrate.sql", output);
  console.log(`\n✅ Exported to data/migrate.sql (${output.length} bytes)`);
  console.log("\nTo import, run:");
  console.log("  psql $DATABASE_URL -f data/migrate.sql");
}

exportToSql();
