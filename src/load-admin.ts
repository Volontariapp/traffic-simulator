import { ApiClient } from './clients/api-client.js';
import { normalizeBaseUrl, parseAccessHeaders } from './load/load-config.js';
import { LoadFixtures, type CleanupReport } from './load/fixtures/load-fixtures.js';
import { openLoadPool } from './load/fixtures/load-pool.js';

/**
 * Preparation et nettoyage des ecritures de la rampe (pool `load.NNNN`) :
 *   yarn load:setup                 cree les comptes absents et les events de fixture (DRAFT)
 *   yarn load:cleanup [--dry-run]   retire follows, souhaits et participations du pool
 *   yarn load:cleanup --purge       retire aussi les events de fixture
 * Le nettoyage se rejoue sans effet de bord et relit tout pour verifier qu'il ne reste rien.
 */
function readCount(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${key}=${raw} invalide : entier >= 1`);
  return value;
}

function printReport(report: CleanupReport): void {
  const line = (label: string, c: CleanupReport['found']): string =>
    `${label} : ${c.follows} follows, ${c.wishes} souhaits, ${c.participations} participations, ${c.events} events`;
  console.log(`[load:cleanup] ${report.dryRun ? 'DRY-RUN, rien n a ete ecrit' : 'nettoyage applique'}`);
  console.log(`[load:cleanup] ${line('trouves', report.found)}`);
  console.log(`[load:cleanup] ${line(report.dryRun ? 'a retirer' : 'restants apres relecture', report.remaining)}`);
  console.log(`[load:cleanup] ${line('hors pool (non touches)', report.foreign)}`);
  if (report.failures > 0) console.log(`[load:cleanup] echecs : ${report.failures}`);
}

async function main(): Promise<void> {
  const [command, ...flags] = process.argv.slice(2);
  if (command !== 'setup' && command !== 'cleanup') {
    throw new Error('Usage : load-admin.ts setup | cleanup [--dry-run] [--purge]');
  }
  const baseUrl = process.env.LOAD_BASE_URL?.trim();
  if (!baseUrl) throw new Error('LOAD_BASE_URL est obligatoire');
  const actorCount = readCount(process.env.LOAD_POOL_ACTORS, 200, 'LOAD_POOL_ACTORS');
  const eventCount = readCount(process.env.LOAD_FIXTURE_EVENTS, 10, 'LOAD_FIXTURE_EVENTS');
  const client = new ApiClient(normalizeBaseUrl(baseUrl), parseAccessHeaders(process.env));

  const pool = await openLoadPool(client, actorCount, command === 'setup');
  const actors = pool.getAllActors();
  if (actors.length === 0) throw new Error('Pool de charge vide : lancer yarn load:setup');
  const fixtures = new LoadFixtures(client, actors);

  if (command === 'setup') {
    const ids = await fixtures.ensureEvents({ eventCount, log: (line) => console.log(line) });
    console.log(`[load:setup] ${actors.length} comptes load, ${ids.length} events de fixture prets`);
  } else {
    const report = await fixtures.cleanup({ dryRun: flags.includes('--dry-run'), purgeEvents: flags.includes('--purge') });
    printReport(report);
    const left = Object.values(report.remaining).reduce((a, b) => a + b, 0);
    if (!report.dryRun && (left > 0 || report.failures > 0)) process.exit(2);
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('[load-admin] echec :', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
