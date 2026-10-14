/**
 * Cadastra um Pi e imprime o EDGE_TOKEN (aparece só uma vez).
 *
 * Uso:
 *   $env:ADMIN_TOKEN="..."; npm run admin:device -- --venue=venue-demo --name="Pi Arena Demo"
 *   --api=http://127.0.0.1:8787   (padrão: produção)
 */

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const api = arg("api", "https://projeto-replay.gabrieltenoriovaz-10a.workers.dev").replace(/\/$/, "");
const venueId = arg("venue");
const name = arg("name");
const adminToken = process.env.ADMIN_TOKEN;

if (!venueId || !name || !adminToken) {
  console.error('Faltou --venue, --name ou a env ADMIN_TOKEN.');
  process.exit(1);
}

const res = await fetch(`${api}/admin/devices`, {
  method: "POST",
  headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
  body: JSON.stringify({ venue_id: venueId, name }),
});
const data = await res.json();
if (!res.ok) {
  console.error(res.status, data);
  process.exit(1);
}

console.log(`device ${data.id} (${data.name}) criado em ${data.venue_id}`);
console.log("\nCole no edge/.env do Pi:\n");
console.log(`EDGE_TOKEN=${data.token}`);
