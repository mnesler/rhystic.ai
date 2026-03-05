import Database from "better-sqlite3";
import pg from "pg";

const { Client } = pg;

const sqlitePath = "./data/mtg.db";
const pgUrl = process.env.DATABASE_URL || "postgresql://maxtory_user:@/mtg?host=/cloudsql/maxtory:us-central1:maxtory-db";

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

async function migrate() {
  console.log("Opening SQLite...");
  const sqlite = new Database(sqlitePath);
  
  console.log("Opening PostgreSQL...");
  const pgClient = new Client({ connectionString: pgUrl });
  await pgClient.connect();
  
  // Migrate cards
  console.log("Migrating cards...");
  const cards = sqlite.prepare("SELECT * FROM cards").all() as SqliteCard[];
  console.log(`  Found ${cards.length} cards`);
  
  for (const card of cards) {
    await pgClient.query(`
      INSERT INTO cards (oracle_id, name, mana_cost, cmc, type_line, oracle_text, colors, color_identity, keywords, power, toughness, loyalty, produced_mana, edhrec_rank, rarity, set_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (oracle_id) DO UPDATE SET
        name = EXCLUDED.name,
        mana_cost = EXCLUDED.mana_cost,
        cmc = EXCLUDED.cmc,
        type_line = EXCLUDED.type_line,
        oracle_text = EXCLUDED.oracle_text,
        colors = EXCLUDED.colors,
        color_identity = EXCLUDED.color_identity,
        keywords = EXCLUDED.keywords,
        power = EXCLUDED.power,
        toughness = EXCLUDED.toughness,
        loyalty = EXCLUDED.loyalty,
        produced_mana = EXCLUDED.produced_mana,
        edhrec_rank = EXCLUDED.edhrec_rank,
        rarity = EXCLUDED.rarity,
        set_code = EXCLUDED.set_code
    `, [
      card.oracle_id, card.name, card.mana_cost, card.cmc, card.type_line, card.oracle_text,
      card.colors, card.color_identity, card.keywords, card.power, card.toughness, card.loyalty,
      card.produced_mana, card.edhrec_rank, card.rarity, card.set_code
    ]);
  }
  console.log(`  Inserted ${cards.length} cards`);
  
  // Migrate card_tags
  console.log("Migrating card_tags...");
  const tags = sqlite.prepare("SELECT * FROM card_tags").all() as SqliteTag[];
  console.log(`  Found ${tags.length} tags`);
  
  if (tags.length > 0) {
    for (const tag of tags) {
      await pgClient.query(`
        INSERT INTO card_tags (oracle_id, tag)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [tag.oracle_id, tag.tag]);
    }
    console.log(`  Inserted ${tags.length} tags`);
  }
  
  // Migrate combos
  console.log("Migrating combos...");
  const combos = sqlite.prepare("SELECT * FROM combos").all() as SqliteCombo[];
  console.log(`  Found ${combos.length} combos`);
  
  for (const combo of combos) {
    await pgClient.query(`
      INSERT INTO combos (id, card_names, produces, description, mana_needed, color_identity, popularity, bracket_tag)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        card_names = EXCLUDED.card_names,
        produces = EXCLUDED.produces,
        description = EXCLUDED.description,
        mana_needed = EXCLUDED.mana_needed,
        color_identity = EXCLUDED.color_identity,
        popularity = EXCLUDED.popularity,
        bracket_tag = EXCLUDED.bracket_tag
    `, [combo.id, combo.card_names, combo.produces, combo.description, combo.mana_needed, combo.color_identity, combo.popularity, combo.bracket_tag]);
  }
  console.log(`  Inserted ${combos.length} combos`);
  
  // Migrate combo_cards
  console.log("Migrating combo_cards...");
  const comboCards = sqlite.prepare("SELECT * FROM combo_cards").all() as SqliteComboCard[];
  console.log(`  Found ${comboCards.length} combo_cards`);
  
  if (comboCards.length > 0) {
    for (const cc of comboCards) {
      await pgClient.query(`
        INSERT INTO combo_cards (combo_id, card_name, oracle_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [cc.combo_id, cc.card_name, cc.oracle_id]);
    }
    console.log(`  Inserted ${comboCards.length} combo_cards`);
  }
  
  // Verify
  console.log("\nVerifying...");
  const pgCards = await pgClient.query("SELECT COUNT(*) as count FROM cards");
  const pgTags = await pgClient.query("SELECT COUNT(*) as count FROM card_tags");
  const pgCombos = await pgClient.query("SELECT COUNT(*) as count FROM combos");
  const pgComboCards = await pgClient.query("SELECT COUNT(*) as count FROM combo_cards");
  
  console.log(`  PostgreSQL cards: ${pgCards.rows[0].count}`);
  console.log(`  PostgreSQL tags: ${pgTags.rows[0].count}`);
  console.log(`  PostgreSQL combos: ${pgCombos.rows[0].count}`);
  console.log(`  PostgreSQL combo_cards: ${pgComboCards.rows[0].count}`);
  
  await pgClient.end();
  sqlite.close();
  
  console.log("\n✅ Migration complete!");
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
