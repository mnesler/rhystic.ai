import Database from "better-sqlite3";
import { writeFileSync } from "fs";

const sqlitePath = "./data/mtg.db";

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/"/g, '""');
  return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
}

function toCsv(columns: string[], rows: unknown[]): string {
  const header = columns.join(',');
  const data = rows.map(row => columns.map(col => escapeCsv((row as Record<string, unknown>)[col])).join(',')).join('\n');
  return header + '\n' + data;
}

function exportTable(tableName: string, columns: string[], rows: unknown[]) {
  const csv = toCsv(columns, rows);
  writeFileSync(`./data/${tableName}.csv`, csv);
  console.log(`  Exported ${rows.length} rows to ${tableName}.csv`);
}

function exportToCsv() {
  console.log("Opening SQLite...");
  const sqlite = new Database(sqlitePath);
  
  // Cards
  console.log("Exporting cards...");
  const cards = sqlite.prepare("SELECT * FROM cards").all();
  exportTable("cards", [
    "oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text",
    "colors", "color_identity", "keywords", "power", "toughness", "loyalty",
    "produced_mana", "edhrec_rank", "rarity", "set_code"
  ], cards);
  
  // Card tags
  console.log("Exporting card_tags...");
  const tags = sqlite.prepare("SELECT * FROM card_tags").all();
  exportTable("card_tags", ["oracle_id", "tag"], tags);
  
  // Combos
  console.log("Exporting combos...");
  const combos = sqlite.prepare("SELECT * FROM combos").all();
  exportTable("combos", ["id", "card_names", "produces", "description", "mana_needed", "color_identity", "popularity", "bracket_tag"], combos);
  
  // Combo cards
  console.log("Exporting combo_cards...");
  const comboCards = sqlite.prepare("SELECT * FROM combo_cards").all();
  exportTable("combo_cards", ["combo_id", "card_name", "oracle_id"], comboCards);
  
  sqlite.close();
  console.log("\n✅ Exported CSV files");
}

exportToCsv();
