export function registerDiscordDiagnostics(client) {
  const diagnosticsEnabled =
    process.env.DISCORD_DIAGNOSTICS === 'true' || process.env.DISCORD_DIAGNOSTICS === '1';

  if (!diagnosticsEnabled) return;

  client.on('warn', (info) => console.warn('[discord warn]', info));
  client.on('error', (error) => console.error('[discord error]', error));

  client.on('shardError', (error, shardId) => {
    console.error(`[discord shardError shard=${shardId}]`, error);
  });
  client.on('shardDisconnect', (event, shardId) => {
    console.warn(
      `[discord shardDisconnect shard=${shardId}] code=${event?.code ?? 'n/a'} reason=${event?.reason ?? 'n/a'}`,
    );
  });
  client.on('shardReconnecting', (shardId) => console.warn(`[discord shardReconnecting shard=${shardId}]`));
  client.on('shardReady', (shardId) => console.log(`[discord shardReady shard=${shardId}]`));
  client.on('shardResume', (replayed, shardId) => {
    console.log(`[discord shardResume shard=${shardId}] replayed=${replayed}`);
  });

  // discord.js REST manager events (if available)
  client.rest?.on?.('rateLimited', (info) => console.warn('[discord rateLimited]', info));

  // Low-level gateway debug (if available)
  client.ws?.on?.('debug', (message) => console.log('[discord ws]', message));
}

