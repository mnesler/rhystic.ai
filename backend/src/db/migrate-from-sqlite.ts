import sqlite from "better-sqlite3";
import pg from "pg";

const sqliteDb = sqlite("/home/maxwell/rhystic.ai/data/mtg.db");

const pgPool = new pg.Pool({
  connectionString: "postgresql://postgres:ChangeMe123!@localhost:5432/mtg",
  ssl: false,
});

const BATCH_SIZE = 1000;

async function migrateTable(
  tableName: string,
  columns: string[],
  transform?: (row: any) => any[]
) {
  console.log(`Migrating ${tableName}...`);
  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all() as any[];
  console.log(`  Found ${rows.length} rows`);

  if (rows.length === 0) {
    console.log("  Skipping (empty)");
    return;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, bi) =>
      `(${columns.map((_, j) => `$${bi * columns.length + j + 1}`).join(",")})`
    ).join(",\n");

    const values = batch.flatMap((row) => {
      const transformed = transform ? transform(row) : columns.map((col) => row[col]);
      return transformed;
    });

    const colList = columns.join(", ");
    const query = `INSERT INTO ${tableName} (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;

    await pgPool.query(query, values);
    console.log(`  Inserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  console.log("  Done");
}

async function migrateCards() {
  await migrateTable(
    "cards",
    ["oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text", "colors", "color_identity", "keywords", "power", "toughness", "loyalty", "produced_mana", "edhrec_rank", "rarity", "set_code", "ingested_at", "updated_at"]
  );
}

async function migrateCombos() {
  await migrateTable(
    "combos",
    ["id", "card_names", "produces", "description", "mana_needed", "color_identity", "popularity", "bracket_tag", "ingested_at"]
  );
}

async function migrateComboCards() {
  await migrateTable(
    "combo_cards",
    ["combo_id", "card_name", "oracle_id"]
  );
}

async function migrateEmbeddings() {
  await migrateTable(
    "card_embeddings",
    ["oracle_id", "model", "embedding", "dims", "created_at"]
  );
}

async function main() {
  try {
    await pgPool.query("SELECT 1");
    console.log("Connected to PostgreSQL\n");

    await migrateCards();
    await migrateCombos();
    await migrateComboCards();
    await migrateEmbeddings();

    console.log("\nMigration complete!");

    const counts = await pgPool.query(`
      SELECT 'cards' as tbl, COUNT(*) as cnt FROM cards
      UNION ALL SELECT 'combos', COUNT(*) FROM combos
      UNION ALL SELECT 'combo_cards', COUNT(*) FROM combo_cards
      UNION ALL SELECT 'card_embeddings', COUNT(*) FROM card_embeddings
    `);
    console.log("\nPostgreSQL counts:");
    for (const row of counts.rows) {
      console.log(`  ${row.tbl}: ${row.cnt}`);
    }

  } finally {
    await pgPool.end();
    sqliteDb.close();
  }
}

main().catch(console.error);