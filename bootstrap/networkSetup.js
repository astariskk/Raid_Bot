import dns from 'node:dns';

export function configureNetworkFromEnv() {
  // Prefer IPv4 when the platform has broken IPv6 egress/DNS (common on some hosts).
  if (['1', 'true', 'yes'].includes(String(process.env.DISCORD_FORCE_IPV4 ?? '').toLowerCase())) {
    try {
      dns.setDefaultResultOrder('ipv4first');
      console.log('[net] Forcing DNS result order: ipv4first');
    } catch (error) {
      console.warn('[net] Failed to set ipv4first DNS result order:', error?.message ?? error);
    }
  }

  // Optional custom DNS servers (comma-separated), e.g. "8.8.8.8,8.8.4.4"
  if (process.env.DISCORD_DNS_SERVERS) {
    const servers = String(process.env.DISCORD_DNS_SERVERS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (servers.length) {
      try {
        dns.setServers(servers);
        console.log('[net] Using custom DNS servers:', servers.join(', '));
      } catch (error) {
        console.warn('[net] Failed to set custom DNS servers:', error?.message ?? error);
      }
    }
  }
}

