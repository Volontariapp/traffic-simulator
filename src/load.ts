import { createInterface } from 'node:readline/promises';
import { ActorPool } from './actors/actor-pool.js';
import { reservedLocalPseudos } from './actors/actor-identity.js';
import { ApiClient } from './clients/api-client.js';
import { loadLoadConfig } from './load/load-config.js';
import { createSender } from './load/load-http.js';
import { renderMarkdown, writeReport } from './load/load-report.js';
import { runRamp } from './load/load-runner.js';

/**
 * Rampe de charge en lecture seule, a lancer depuis une machine hors du cluster (sinon la charge
 * consomme la RAM de l'hote que l'on cherche a mesurer). Voir README, section "Rampe de charge".
 * Coupez d'abord l'activite ambiante du simulateur : elle fausse la mesure.
 */
async function main(): Promise<void> {
  const config = loadLoadConfig();
  console.log(`[load] cible ${config.baseUrl}`);
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

  const report = await runRamp({
    config,
    actors,
    send: createSender({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      extraHeaders: config.accessHeaders,
      refresher: (stale) => pool.renewSession(stale),
    }),
    log: (line) => console.log(line),
    shouldStop: () => stopRequested,
    confirm,
  });
  rl?.close();

  await writeReport(config.reportPath, report);
  console.log(`\n${renderMarkdown(report)}`);
  console.log(`\n[load] rapport JSON : ${config.reportPath}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('[load] echec :', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
