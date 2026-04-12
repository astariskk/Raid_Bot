import dns from 'node:dns';
import https from 'node:https';

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
    console.log(`[net] GET /api/v10/gateway: ${res.statusCode ?? 'n/a'}`);
  } catch (error) {
    console.warn('[net] GET /api/v10/gateway failed:', error?.code ?? error?.message ?? error);
  }
}

