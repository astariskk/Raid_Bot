import { createRequire } from 'module';
import dns from 'dns';

let client = null;
let db = null;
let configuredDns = false;

export async function connectMongo() {
    if (db) return db;

    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not defined.');
    validateMongoUri(uri);
    configureMongoDnsServers();

    const require = createRequire(import.meta.url);
    const { MongoClient } = require('mongodb');

    client = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
    });
    try {
        await client.connect();
        db = client.db(process.env.MONGODB_DB || undefined);
        await ensureIndexes(db);
        return db;
    } catch (error) {
        client = null;
        db = null;
        throw normalizeMongoConnectionError(error);
    }
}

export async function closeMongo() {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

export function getMongoDb() {
    if (!db) throw new Error('MongoDB not connected. Call connectMongo() first.');
    return db;
}

function validateMongoUri(uri) {
    if (/\/\/[^/\s]*<[^>]+>[^@\s]*@/.test(uri)) {
        throw new Error(
            'MONGODB_URI still contains angle-bracket placeholder text. Replace `<password>` with the real Atlas database user password and remove the `<` and `>` characters.'
        );
    }
}

function configureMongoDnsServers() {
    if (configuredDns) return;
    configuredDns = true;

    const raw = String(process.env.MONGODB_DNS_SERVERS ?? '').trim();
    if (!raw) return;

    const servers = raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    if (!servers.length) return;
    dns.setServers(servers);
    console.log(`[mongo] DNS servers: ${servers.join(', ')}`);
}

function normalizeMongoConnectionError(error) {
    if (error?.code === 8000 || /bad auth|authentication failed/i.test(String(error?.message ?? ''))) {
        return new Error(
            'MongoDB Atlas authentication failed. Check the Database Access username/password in MONGODB_URI. If you copied the Atlas sample URI, remove the `<` and `>` around the password. If the password contains special characters like @, :, /, ?, #, [, ], encode them with percent-encoding.',
            { cause: error }
        );
    }

    if (error?.code === 'ECONNREFUSED' && String(error?.hostname ?? '').includes('_mongodb._tcp.')) {
        return new Error(
            'MongoDB Atlas DNS lookup failed for the SRV record. Check your internet/DNS settings, try setting MONGODB_DNS_SERVERS=8.8.8.8,8.8.4.4, or use a non-SRV mongodb:// Atlas connection string. Atlas must also allow your current IP in Network Access.',
            { cause: error }
        );
    }

    return error;
}

async function ensureIndexes(database) {
    await Promise.all([
        database.collection('leaderboard_users').createIndex({ user_id: 1 }, { unique: true }),
        database.collection('leaderboard_daily_points').createIndex({ user_id: 1, date: 1 }, { unique: true }),
        database.collection('raid_states').createIndex({ status: 1, created_at: 1 }),
        database.collection('raid_ticket_helpers').createIndex({ raid_id: 1, helper_id: 1 }, { unique: true }),
        database.collection('raid_ticket_helpers').createIndex({ raid_id: 1, joined_at: 1 }),
        database.collection('raid_tasks').createIndex({ key: 1 }, { unique: true }),
        database.collection('raid_tasks').createIndex({ category: 1, sort_order: 1, display_name: 1 }),
        database.collection('raid_task_categories').createIndex({ key: 1 }, { unique: true }),
        database.collection('gif_table').createIndex({ command: 1 }, { unique: true }),
        database.collection('charts_table').createIndex({ key: 1 }, { unique: true }),
    ]);
}
