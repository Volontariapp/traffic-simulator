import { ActorPool } from '../../actors/actor-pool.js';
import { loadIdentityOptions } from '../../actors/actor-identity.js';
import type { ApiClient } from '../../clients/api-client.js';

/**
 * Pool `load.NNNN@simulator.volontariapp.test` : les seuls comptes qui ecrivent pendant la rampe.
 * `createMissing` vrai seulement pour `load:setup` ; ailleurs, un compte absent est ignore.
 */
export async function openLoadPool(client: ApiClient, count: number, createMissing: boolean): Promise<ActorPool> {
  const pool = new ActorPool(client, 800, loadIdentityOptions(), createMissing);
  await pool.initialize(count, createMissing ? 1000 : 0, false);
  return pool;
}
