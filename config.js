// Config pública de Mesa 2.0. La anon key es pública por diseño (la muralla es
// RLS + whitelist, no el secreto de esta llave). El service role JAMÁS va aquí.
window.MESA2 = {
  SUPABASE_URL: "https://pcslhnnaohsdouddlfyv.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjc2xobm5hb2hzZG91ZGRsZnl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjMxMzYsImV4cCI6MjEwNDc5OTEzNn0.uoASP55AbyZKSyIHuIMsMo-RJ8YbaikbhKyzoiTsZXA",
  // Proxy de firma de brókeres (VPS, expuesto por Tailscale Funnel). Solo firma
  // OAuth de lectura; el token del usuario vive en ESTE dispositivo, no aquí.
  PROXY_URL: "https://mesa2.taila0d73b.ts.net"
};
