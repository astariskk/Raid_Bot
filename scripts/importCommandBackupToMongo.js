import 'dotenv/config';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { closeMongo, connectMongo, getMongoDb } from '../utils/MongoDB/mongoClient.js';

const GIF_SOURCE = resolve('docs/database/gif_table_rows.json');
const CHART_SOURCE = resolve('docs/database/charts_table_rows.json');
const REPLACE = process.argv.includes('--replace');

function parseJsonField(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function normalizeGifRow(row) {
  const command = String(row.command ?? '').trim().toLowerCase();
  if (!command) return null;

  return compactObject({
    command,
    kind: row.kind === 'gif' ? 'gif' : 'text',
    title: row.title ?? null,
    footer: row.footer ?? null,
    attachment_url: row.attachment_url ?? null,
    archived_message_url: row.archived_message_url ?? null,
    archived_message_id: row.archived_message_id ?? null,
    archived_channel_id: row.archived_channel_id ?? null,
    ping_user_ids: parseJsonField(row.ping_user_ids, []),
    text_label: row.text_label ?? null,
    text_description: row.text_description ?? '',
    text_content: row.text_content ?? null,
    color: row.color ?? null,
    enabled: row.enabled !== false,
    created_at: parseDate(row.created_at) ?? new Date(),
    updated_at: parseDate(row.updated_at) ?? new Date(),
  });
}

function normalizeChartRow(row) {
  const key = String(row.key ?? '').trim().toLowerCase();
  if (!key) return null;

  return compactObject({
    key,
    category: String(row.category ?? 'general').trim() || 'general',
    title: String(row.title ?? row.key ?? 'Chart').trim() || 'Chart',
    triggers: parseJsonField(row.triggers, []),
    variants: parseJsonField(row.variants, []),
    enabled: row.enabled !== false,
    archived_message_url: row.archived_message_url ?? null,
    archived_message_id: row.archived_message_id ?? null,
    archived_channel_id: row.archived_channel_id ?? null,
    created_at: parseDate(row.created_at) ?? new Date(),
    updated_at: parseDate(row.updated_at) ?? new Date(),
  });
}

async function readRows(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error(`${filePath} must contain a JSON array.`);
  return rows;
}

async function upsertRows(collection, docs, keyField) {
  if (REPLACE) await collection.deleteMany({});
  if (!docs.length) return { upserted: 0, matched: 0 };

  const result = await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { [keyField]: doc[keyField] },
        update: { $set: doc },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    upserted: result.upsertedCount ?? 0,
    matched: result.matchedCount ?? 0,
  };
}

async function main() {
  await connectMongo();
  const db = getMongoDb();

  const gifRows = (await readRows(GIF_SOURCE)).map(normalizeGifRow).filter(Boolean);
  const chartRows = (await readRows(CHART_SOURCE)).map(normalizeChartRow).filter(Boolean);

  await Promise.all([
    db.collection('gif_table').createIndex({ command: 1 }, { unique: true }),
    db.collection('charts_table').createIndex({ key: 1 }, { unique: true }),
  ]);

  const gifResult = await upsertRows(db.collection('gif_table'), gifRows, 'command');
  const chartResult = await upsertRows(db.collection('charts_table'), chartRows, 'key');

  console.log(`[mongo] gif_table: ${gifRows.length} row(s), ${gifResult.upserted} inserted, ${gifResult.matched} updated/matched.`);
  console.log(`[mongo] charts_table: ${chartRows.length} row(s), ${chartResult.upserted} inserted, ${chartResult.matched} updated/matched.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => {});
  });
