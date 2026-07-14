// Self-check de createActionLock (lock anti doble-click por clave).
// Correr:  npx tsx scripts/check-action-lock.mts
import assert from 'node:assert';
import { createActionLock } from '../lib/utils';

// Promesa que resolvemos a mano para controlar cuándo "termina" una acción.
const defer = () => { let resolve!: () => void; const p = new Promise<void>(r => (resolve = r)); return { p, resolve }; };

async function main() {
  // 1) Doble-click: dos disparos concurrentes con la MISMA key → fn corre una sola vez.
  {
    const run = createActionLock();
    let calls = 0;
    const gate = defer();
    const a = run('t1', async () => { calls++; await gate.p; });
    const b = run('t1', async () => { calls++; await gate.p; }); // lock tomado → se ignora
    assert.strictEqual(calls, 1, 'segundo click concurrente con misma key no debe ejecutar fn');
    gate.resolve();
    await Promise.all([a, b]);
    assert.strictEqual(calls, 1, 'sigue en 1 tras settlear');
  }

  // 2) Keys distintas (tickets distintos) → corren ambas en paralelo.
  {
    const run = createActionLock();
    let calls = 0;
    const gate = defer();
    const a = run('t1', async () => { calls++; await gate.p; });
    const b = run('t2', async () => { calls++; await gate.p; });
    assert.strictEqual(calls, 2, 'keys distintas no se bloquean entre sí');
    gate.resolve();
    await Promise.all([a, b]);
  }

  // 3) El lock se libera al settlear → un disparo posterior con la misma key vuelve a correr.
  {
    const run = createActionLock();
    let calls = 0;
    await run('t1', async () => { calls++; });
    await run('t1', async () => { calls++; });
    assert.strictEqual(calls, 2, 'tras settlear, la misma key vuelve a ejecutar');
  }

  // 4) Se libera aunque fn lance (finally).
  {
    const run = createActionLock();
    let calls = 0;
    await run('t1', async () => { calls++; throw new Error('boom'); }).catch(() => {});
    await run('t1', async () => { calls++; });
    assert.strictEqual(calls, 2, 'el lock se libera aunque fn lance');
  }

  console.log('OK — createActionLock');
}

main();
