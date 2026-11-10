import { createInterface } from 'node:readline/promises';
import { ActorPool } from './actors/actor-pool.js';
import { reservedLocalPseudos } from './actors/actor-identity.js';
import { ApiClient } from './clients/api-client.js';
import { loadLoadConfig } from './load/load-config.js';
import { createSender } from './load/load-http.js';
import { renderMarkdown, writeReport } from './load/load-report.js';
import { runRamp } from './load/load-runner.js';
import { AppPlanner, primeAppPlanner } from './load/app/app-planner.js';
import type { TargetPlanner } from './load/load-request.js';
import { WritePlanner } from './load/app/write-planner.js';
import { LoadFixtures } from './load/fixtures/load-fixtures.js';
import { openLoadPool } from './load/fixtures/load-pool.js';
import { AsyncProbe } from './load/probe/async-probe.js';
import { createProbeSocketFactory } from './load/probe/socket-factory.js';

/**
 * Rampe de charge (modes `routes` et `app`, ecritures du pool `load.NNNN` avec LOAD_WRITES), a lancer depuis une machine hors du cluster (sinon la charge
 * consomme la RAM de l'hote que l'on cherche a mesurer). Voir README, section "Rampe de charge".
 * Coupez d'abord l'activite ambiante du simulateur : elle fausse la mesure.
 */
async function main(): Promise<void> {
  const config = loadLoadConfig();
  console.log(`[load] cible ${config.baseUrl}, mode ${config.mode}`);
  console.log(`[load] paliers ${config.steps.join(', ')} req/s, ${config.stepSeconds} s chacun`);

  const hasAccessToken = Object.keys(config.accessHeaders).length > 0;
  console.log(`[load] jeton Cloudflare Access : ${hasAccessToken ? 'present' : 'absent'}`);

  const client = new ApiClient(config.baseUrl, config.accessHeaders);
  // Memes options d'identite que le pool principal du simulateur : aucun compte n'est renomme
  const pool = new ActorPool(client, 800, { reservedPseudos: reservedLocalPseudos() });
  await pool.initialize(config.actors, 0, false);
  const actors = pool.getAllActors();
  if (actors.length < 2) throw new Error(`Pool insuffisant : ${actors.length} acteur(s) connecte(s)`);
  pool.startTokenKeepAlive({ intervalMs: 60_000, marginMs: 180_000, canRun: () => true });

  let stopRequested = false;
  process.on('SIGINT', () => {
    if (stopRequested) process.exit(130);
    stopRequested = true;
    console.log('[load] arret demande : fin de la fenetre en cours (Ctrl+C a nouveau pour couper)');
  });

  const rl = config.confirmEachStep ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const confirm = rl
    ? async (rate: number): Promise<boolean> => {
        const answer = await rl.question(`Lancer le palier ${rate} req/s sur ${config.baseUrl} ? [o/N] `);
        return /^(o|oui|y|yes)$/i.test(answer.trim());
      }
    : undefined;

  // Ecritures : pool load ouvert sans creer de compte (yarn load:setup d'abord), client a part
  // pour que son renouvellement de session ne remplace pas celui du pool de lecture
  let loadPool: ActorPool | undefined;
  let fixtures: LoadFixtures | undefined;
  let writes: WritePlanner | undefined;
  let probe: AsyncProbe | undefined;
  if (config.writes.length > 0) {
    const loadClient = new ApiClient(config.baseUrl, config.accessHeaders);
    loadPool = await openLoadPool(loadClient, config.poolActors, false);
    const loadActors = loadPool.getAllActors();
    loadPool.startTokenKeepAlive({ intervalMs: 60_000, marginMs: 180_000, canRun: () => true });
    fixtures = new LoadFixtures(loadClient, loadActors);
    const fixtureEvents = await fixtures.findEvents();
    // Sonde : seuls like et commentaire renvoient un message WebSocket a leur emetteur
    const probed = config.writes.some((w) => w === 'like-toggle' || w === 'comment-cycle');
    if (probed && config.probeSockets > 0) {
      probe = new AsyncProbe({
        accounts: loadActors.slice(0, config.probeSockets).map((a) => ({ userId: a.id, token: a.accessToken })),
        factory: createProbeSocketFactory(config.baseUrl, config.accessHeaders),
        lostAfterMs: config.probeLostAfterMs,
      });
      probe.start();
      console.log(`[load] sonde asynchrone : ${probe.socketCount} sockets`);
    }
    writes = new WritePlanner({ loadActors, fixtureEvents, probe });
    console.log(
      `[load] ecritures ${config.writes.join(', ')} : ${loadActors.length} comptes load, ${fixtureEvents.length} events de fixture`,
    );
  }

  const send = createSender({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    extraHeaders: config.accessHeaders,
    refresher: async (stale) => (await pool.renewSession(stale)) ?? loadPool?.renewSession(stale),
  });

  let planner: TargetPlanner | undefined;
  if (config.mode === 'app') {
    const appPlanner = new AppPlanner({ mix: config.appMix, actors, writes });
    const primed = await primeAppPlanner(appPlanner, send, actors);
    console.log(
      `[load] mode app : ${primed} requetes de preparation, ${appPlanner.posts.size} posts, ${appPlanner.events.size} events, ${appPlanner.users.size} utilisateurs connus`,
    );
    planner = appPlanner;
  }

  const report = await runRamp({
    config,
    actors,
    send,
    planner,
    probe,
    log: (line) => console.log(line),
    shouldStop: () => stopRequested,
    confirm,
  });
  rl?.close();
  probe?.close();

  await writeReport(config.reportPath, report);
  console.log(`\n${renderMarkdown(report)}`);
  console.log(`\n[load] rapport JSON : ${config.reportPath}`);

  // Toute rampe qui ecrit se termine par le nettoyage du pool, verifie par relecture
  if (fixtures) {
    const cleanup = await fixtures.cleanup({ dryRun: false, purgeEvents: false });
    const left = Object.values(cleanup.remaining).reduce((a, b) => a + b, 0);
    console.log(
      `[load] nettoyage : ${JSON.stringify(cleanup.found)} retires, ${left} restant(s), ${cleanup.failures} echec(s)`,
    );
    if (left > 0 || cleanup.failures > 0) {
      console.log('[load] il reste des objets du pool : relancer yarn load:cleanup');
      process.exit(2);
    }
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('[load] echec :', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
