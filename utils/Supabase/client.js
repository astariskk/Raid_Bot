function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

export function getSupabaseConfig() {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw new Error('SUPABASE_URL is not defined.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined.');
  return { url, key };
}

function buildUrl(path) {
  const { url } = getSupabaseConfig();
  return `${url.replace(/\/$/, '')}${path}`;
}

function addFilter(searchParams, filter) {
  if (!filter || !filter.column) return;
  const op = String(filter.op ?? 'eq').trim();
  const value = filter.value;
  if (op === 'in') {
    const values = Array.isArray(value) ? value : [];
    searchParams.append(filter.column, `in.(${values.map((v) => String(v)).join(',')})`);
    return;
  }
  if (op === 'is') {
    searchParams.append(filter.column, `is.${String(value)}`);
    return;
  }
  if (op === 'contains') {
    searchParams.append(filter.column, `cs.${JSON.stringify(value)}`);
    return;
  }
  searchParams.append(filter.column, `${op}.${String(value)}`);
}

export async function supabaseRequest(path, { method = 'GET', query = {}, headers = {}, body } = {}) {
  const { key } = getSupabaseConfig();
  const url = new URL(buildUrl(path));
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...headers,
    },
    body,
  });

  return response;
}

export async function supabaseSelect(table, {
  select = '*',
  filters = [],
  order = [],
  limit,
  offset,
} = {}) {
  const query = new URLSearchParams();
  query.set('select', select);
  for (const filter of filters) addFilter(query, filter);
  for (const ord of order ?? []) {
    if (!ord?.column) continue;
    const dir = String(ord.direction ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    query.append('order', `${ord.column}.${dir}${ord.nullsLast ? '.nullslast' : ''}`);
  }
  if (limit !== undefined) query.set('limit', String(limit));
  if (offset !== undefined) query.set('offset', String(offset));

  const response = await supabaseRequest(`/rest/v1/${encodeURIComponent(table)}?${query.toString()}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase select failed for ${table}: ${response.status} ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export async function supabaseSelectOne(table, options = {}) {
  const rows = await supabaseSelect(table, { ...options, limit: 1 });
  return rows[0] ?? null;
}

export async function supabaseUpsert(table, rows, { onConflict } = {}) {
  let payload = Array.isArray(rows) ? rows : [rows];
  const response = await supabaseRequest(`/rest/v1/${encodeURIComponent(table)}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const missingColumn = detail.match(/Could not find the '([^']+)' column/i)?.[1];
    if (missingColumn && payload.some((row) => Object.prototype.hasOwnProperty.call(row ?? {}, missingColumn))) {
      console.warn(`Supabase schema cache does not include ${table}.${missingColumn}; retrying upsert without that column.`);
      payload = payload.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const { [missingColumn]: _omitted, ...rest } = row;
        return rest;
      });
      return supabaseUpsert(table, payload, { onConflict });
    }
    throw new Error(`Supabase upsert failed for ${table}: ${response.status} ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export async function supabaseUpdate(table, patch, filters = []) {
  const query = new URLSearchParams();
  for (const filter of filters) addFilter(query, filter);
  const response = await supabaseRequest(`/rest/v1/${encodeURIComponent(table)}${query.toString() ? `?${query.toString()}` : ''}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase update failed for ${table}: ${response.status} ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export async function supabaseDelete(table, filters = []) {
  const query = new URLSearchParams();
  for (const filter of filters) addFilter(query, filter);
  const response = await supabaseRequest(`/rest/v1/${encodeURIComponent(table)}${query.toString() ? `?${query.toString()}` : ''}`, {
    method: 'DELETE',
    headers: {
      Prefer: 'return=representation',
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase delete failed for ${table}: ${response.status} ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export async function supabaseRpc(name, args = {}) {
  const response = await supabaseRequest(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase RPC failed for ${name}: ${response.status} ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function supabaseStorageObjectUrl(bucket, objectPath) {
  const { url } = getSupabaseConfig();
  const encodedPath = String(objectPath)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

export async function supabaseDownloadObject(bucket, objectPath) {
  const { key } = getSupabaseConfig();
  const response = await fetch(supabaseStorageObjectUrl(bucket, objectPath), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to download ${bucket}/${objectPath}: ${response.status} ${detail.slice(0, 200)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}
