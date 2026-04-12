function diagnosticsEnabled() {
  return process.env.DISCORD_DIAGNOSTICS === 'true' || process.env.DISCORD_DIAGNOSTICS === '1';
}

export function configureDebugFromEnv() {
  if (!diagnosticsEnabled()) return;

  const wanted = ['ws', 'discord.js'];
  const current = String(process.env.DEBUG ?? '').trim();
  const parts = current
    ? current
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  for (const w of wanted) {
    if (!parts.includes(w)) parts.push(w);
  }

  process.env.DEBUG = parts.join(',');
  console.log('[debug] DEBUG:', process.env.DEBUG);
}

