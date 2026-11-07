import { ApiClient } from './clients/api-client.js';
import { MediaUploader } from './media/uploader.js';
import { ActorPool } from './actors/actor-pool.js';
import { ParisLiveEngine } from './engines/paris-live.engine.js';
import { MassEventsEngine } from './engines/mass-events.engine.js';
import { UserReactionEngine } from './engines/user-reaction.engine.js';

// Configuration via variables d'environnement
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';
const TICK_INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS || '8000', 10);
const EVENT_LIFESPAN_SEC = parseInt(process.env.EVENT_LIFESPAN_SEC || '180', 10);
const TARGET_ACTORS = parseInt(process.env.TARGET_ACTORS || '120', 10);
const EVENTS_PER_DISTRICT = parseInt(process.env.EVENTS_PER_DISTRICT || '3', 10);
const PARALLEL_DISTRICT_BATCH = parseInt(process.env.PARALLEL_DISTRICT_BATCH || '4', 10);
const INITIAL_MASS_SEED = process.env.INITIAL_MASS_SEED === 'true';
const MASS_EVENTS_COUNT = parseInt(process.env.MASS_EVENTS_COUNT || '150', 10);

console.log('====================================================');
console.log('🤖 Volontariapp Live Traffic Simulator (Daemon)');
console.log('====================================================');
console.log(`📡 API Gateway URL       : ${API_GATEWAY_URL}`);
console.log(`⏱️  Tick Interval         : ${TICK_INTERVAL_MS}ms`);
console.log(`⏳ Event Lifespan        : ${EVENT_LIFESPAN_SEC}s`);
console.log(`👥 Target Actors         : ${TARGET_ACTORS} (Vivier déterministe)`);
console.log(`⚡ Events per District   : ${EVENTS_PER_DISTRICT} (${20 * EVENTS_PER_DISTRICT} events simultanés)`);
console.log(`🔀 Concurrence Arrond.   : ${PARALLEL_DISTRICT_BATCH} par vague`);
console.log(`🌍 Mass Events Seed      : ${INITIAL_MASS_SEED ? `Oui (${MASS_EVENTS_COUNT} events)` : 'Non'}`);
console.log('====================================================');

let isRunning = true;

async function bootstrap() {
  const apiClient = new ApiClient(API_GATEWAY_URL);
  const mediaUploader = new MediaUploader(API_GATEWAY_URL);
  const actorPool = new ActorPool(apiClient);

  // 1. Initialiser le pool d'acteurs virtuels
  await actorPool.initialize(TARGET_ACTORS);

  if (actorPool.getAllActors().length === 0) {
    console.error('❌ Échec initialisation : aucun acteur n’a pu être créé. Vérifiez que api-gateway est démarré.');
    process.exit(1);
  }

  // 2. Initialisation des moteurs
  const parisLiveEngine = new ParisLiveEngine(
    apiClient,
    actorPool,
    mediaUploader,
    EVENT_LIFESPAN_SEC,
    EVENTS_PER_DISTRICT,
    PARALLEL_DISTRICT_BATCH,
  );
  const massEventsEngine = new MassEventsEngine(apiClient, actorPool);
  const userReactionEngine = new UserReactionEngine(apiClient, actorPool);

  // 3. Peuplement initial de masse si activé
  if (INITIAL_MASS_SEED) {
    await massEventsEngine.seedMassEvents(MASS_EVENTS_COUNT);
  }

  // 4. Boucle d'orchestration continue (20 arrondissements en direct + réaction utilisateur)
  console.log('\n🌟 Démarrage de la boucle temps réel (20 arrondissements de Paris + écoute sociale)...');

  const runLoop = async () => {
    while (isRunning) {
      try {
        await Promise.allSettled([
          parisLiveEngine.tick(),
          userReactionEngine.tick(),
        ]);
      } catch (err) {
        console.error('[Daemon] Erreur dans la boucle de simulation :', err instanceof Error ? err.message : String(err));
      }
      await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    }
    console.log('[Daemon] Boucle de simulation arrêtée.');
  };

  runLoop();
}

function handleShutdown(signal: string) {
  console.log(`\n🛑 Signal ${signal} reçu. Arrêt gracieux du Traffic Simulator...`);
  isRunning = false;
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

bootstrap().catch((err) => {
  console.error('💥 Erreur fatale au démarrage du Traffic Simulator :', err);
  process.exit(1);
});

