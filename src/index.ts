import { ApiClient } from './clients/api-client.js';
import { MediaUploader } from './media/uploader.js';
import { ActorPool } from './actors/actor-pool.js';
import { ParisLiveEngine } from './engines/paris-live.engine.js';
import { MassEventsEngine } from './engines/mass-events.engine.js';
import { UserReactionEngine } from './engines/user-reaction.engine.js';
import { loadConfig } from './config/simulator-config.js';
import { getSleepPhase } from './schedule/sleep-window.js';

const config = loadConfig();
const { sleep, reaction } = config;

console.log('====================================================');
console.log('Volontariapp Live Traffic Simulator (Daemon)');
console.log('====================================================');
console.log(`API Gateway URL       : ${config.apiGatewayUrl}`);
console.log(`Tick Interval         : ${config.tickIntervalMs}ms`);
console.log(`Event Lifespan        : ${config.eventLifespanSec}s`);
console.log(`Target Actors         : ${config.targetActors}`);
console.log(`Events per District   : ${config.eventsPerDistrict} (${20 * config.eventsPerDistrict} events simultanes)`);
console.log(`Concurrence Arrond.   : ${config.parallelDistrictBatch} par vague`);
console.log(`Mass Events Seed      : ${config.initialMassSeed ? `Oui (${config.massEventsCount} events)` : 'Non'}`);
console.log(
  `Reactions posts       : ${reaction.likesMin}-${reaction.likesMax} likes, ${reaction.commentsMin}-${reaction.commentsMax} commentaires, scan ${reaction.scanIntervalMs}ms`,
);
console.log(
  `Fenetre de sommeil    : ${
    sleep.enabled ? `${sleep.startHour}h-${sleep.endHour}h (${sleep.timeZone}), vidage ${sleep.drainSec}s avant` : 'desactivee'
  }`,
);
console.log('====================================================');

let isRunning = true;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attente decoupee en petits pas pour reagir vite a l'arret du process. */
async function waitWhileRunning(ms: number): Promise<void> {
  const step = 1000;
  for (let waited = 0; waited < ms && isRunning; waited += step) {
    await wait(Math.min(step, ms - waited));
  }
}

async function bootstrap() {
  const apiClient = new ApiClient(config.apiGatewayUrl);
  const mediaUploader = new MediaUploader(config.apiGatewayUrl);
  const actorPool = new ActorPool(apiClient);

  // Demarre pendant la nuit : on ne touche pas a l'API avant le reveil
  if (getSleepPhase(new Date(), sleep) === 'asleep') {
    console.log('[Daemon] Demarrage dans la fenetre de sommeil : initialisation differee au reveil.');
    while (isRunning && getSleepPhase(new Date(), sleep) === 'asleep') {
      await waitWhileRunning(30_000);
    }
    if (!isRunning) return;
  }

  // 1. Initialiser le pool d'acteurs virtuels
  await actorPool.initialize(config.targetActors, config.actorBatchPauseMs);

  if (actorPool.getAllActors().length === 0) {
    console.error('Echec initialisation : aucun acteur n’a pu etre cree. Verifiez que api-gateway est demarre.');
    process.exit(1);
  }

  // 2. Initialisation des moteurs
  const parisLiveEngine = new ParisLiveEngine(
    apiClient,
    actorPool,
    mediaUploader,
    config.eventLifespanSec,
    config.eventsPerDistrict,
    config.parallelDistrictBatch,
  );
  const massEventsEngine = new MassEventsEngine(apiClient, actorPool);
  const userReactionEngine = new UserReactionEngine(apiClient, actorPool, reaction);

  // 3. Peuplement initial de masse si active
  if (config.initialMassSeed) {
    await massEventsEngine.seedMassEvents(config.massEventsCount);
  }

  // 4. Deux boucles independantes : les arrondissements (lente) et la reaction sociale (rapide)
  console.log('\nDemarrage de la boucle temps reel (20 arrondissements de Paris + ecoute sociale)...');

  let wasAsleep = false;

  const liveLoop = async () => {
    while (isRunning) {
      const phase = getSleepPhase(new Date(), sleep);

      if (phase === 'asleep') {
        if (!wasAsleep) {
          wasAsleep = true;
          console.log('[Daemon] Entree dans la fenetre de sommeil : cloture des events et mise en pause.');
          userReactionEngine.reset();
          await parisLiveEngine.finishAllActive();
        }
        await waitWhileRunning(30_000);
        continue;
      }

      if (wasAsleep) {
        wasAsleep = false;
        console.log('[Daemon] Reveil : rafraichissement des sessions.');
        await actorPool.refreshAllTokens();
      }

      parisLiveEngine.setSpawnEnabled(phase === 'awake');

      try {
        await parisLiveEngine.tick();
      } catch (err) {
        console.error('[Daemon] Erreur dans la boucle des arrondissements :', err instanceof Error ? err.message : String(err));
      }
      await waitWhileRunning(config.tickIntervalMs);
    }
    console.log('[Daemon] Boucle des arrondissements arretee.');
  };

  const reactionLoop = async () => {
    while (isRunning) {
      // Pas de reaction tant que le sommeil est actif ni juste apres le reveil (tokens a rafraichir)
      if (getSleepPhase(new Date(), sleep) === 'asleep' || wasAsleep) {
        await waitWhileRunning(5_000);
        continue;
      }
      try {
        await userReactionEngine.tick();
      } catch (err) {
        console.error('[Daemon] Erreur dans la boucle de reaction :', err instanceof Error ? err.message : String(err));
      }
      await waitWhileRunning(reaction.tickIntervalMs);
    }
    console.log('[Daemon] Boucle de reaction arretee.');
  };

  void liveLoop();
  void reactionLoop();
}

function handleShutdown(signal: string) {
  console.log(`\nSignal ${signal} recu. Arret gracieux du Traffic Simulator...`);
  isRunning = false;
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

bootstrap().catch((err) => {
  console.error('Erreur fatale au demarrage du Traffic Simulator :', err);
  process.exit(1);
});
