import dns from 'node:dns';
import https from 'node:https';
import { WebSocket } from 'undici';

function isEnabled() {
  return process.env.DISCORD_DIAGNOSTICS === 'true' || process.env.DISCORD_DIAGNOSTICS === '1';
}

function httpsGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      // Drain body to allow socket reuse.
      res.on('data', () => {});
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

export async function logDiscordConnectivity() {
  if (!isEnabled()) return;

  const lookups = ['gateway.discord.gg', 'discord.com'];

  for (const host of lookups) {
    try {
      const results = await dns.promises.lookup(host, { all: true });
      const addrs = results.map((r) => `${r.address}/${r.family}`).join(', ');
      console.log(`[net] dns.lookup ${host}: ${addrs || '(no results)'}`);
    } catch (error) {
      console.warn(`[net] dns.lookup ${host} failed:`, error?.code ?? error?.message ?? error);
    }
  }

  try {
    const res = await httpsGet('https://discord.com/api/v10/gateway', 10000);
    const status = res.statusCode ?? 'n/a';
    if (status === 429) {
      const retryAfter = res.headers?.['retry-after'] ?? res.headers?.['Retry-After'] ?? null;
      console.warn(`[net] GET /api/v10/gateway: 429 (rate limited) retry-after=${retryAfter ?? 'n/a'}`);
    } else {
      console.log(`[net] GET /api/v10/gateway: ${status}`);
    }
  } catch (error) {
    console.warn('[net] GET /api/v10/gateway failed:', error?.code ?? error?.message ?? error);
  }

  // WebSocket handshake probe to the actual gateway. If this fails/hangs, Discord READY will never fire.
  await new Promise((resolve) => {
    const url = 'wss://gateway.discord.gg/?v=10&encoding=json';
    let settled = false;

    const finish = (label, extra) => {
      if (settled) return;
      settled = true;
      if (extra !== undefined) console.log(`[net] ${label}`, extra);
      else console.log(`[net] ${label}`);
      resolve();
    };

    const ws = new WebSocket(url);
    const timeoutMs = Number(process.env.DISCORD_WSS_PROBE_TIMEOUT_MS ?? 10000);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      finish(`WSS gateway probe: TIMEOUT after ${timeoutMs}ms`);
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      finish('WSS gateway probe: OPEN');
    };
    ws.onmessage = () => {
      // Even receiving Hello is a good sign; close right away.
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      finish('WSS gateway probe: MESSAGE');
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish('WSS gateway probe: ERROR (no details available from WebSocket API)');
    };
    ws.onclose = (event) => {
      clearTimeout(timer);
      // If it closes before opening, capture code/reason.
      finish(
        `WSS gateway probe: CLOSE code=${event?.code ?? 'n/a'} reason=${event?.reason ?? 'n/a'} clean=${event?.wasClean ?? 'n/a'}`,
      );
    };
  });
}
