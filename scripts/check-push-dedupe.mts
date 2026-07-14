// Self-check de createRecentEventGuard (guard de idempotencia por evento).
// Correr:  npx tsx scripts/check-push-dedupe.mts
import assert from 'node:assert';
import { createRecentEventGuard } from '../api/push-dedupe';

async function main() {
  // 1) Misma key dos veces seguidas → 1ra nueva (false), 2da vista (true → skip).
  {
    const seen = createRecentEventGuard(60_000);
    assert.strictEqual(seen('t1:NEW_TICKET:x'), false, 'primera vez: nueva (no skip)');
    assert.strictEqual(seen('t1:NEW_TICKET:x'), true,  'segunda vez dentro del ttl: vista (skip)');
  }

  // 2) Keys distintas no se bloquean entre sí.
  {
    const seen = createRecentEventGuard(60_000);
    assert.strictEqual(seen('t1:NEW_TICKET:x'), false, 'key A: nueva');
    assert.strictEqual(seen('t2:STATUS_UPDATE:y'), false, 'key distinta: no bloqueada');
  }

  // 3) Tras pasar el ttl, la misma key vuelve a considerarse nueva.
  {
    const seen = createRecentEventGuard(5); // ttl chico
    assert.strictEqual(seen('t1:NEW_TICKET:x'), false, 'nueva');
    assert.strictEqual(seen('t1:NEW_TICKET:x'), true,  'vista dentro del ttl');
    await new Promise(r => setTimeout(r, 20)); // dejar vencer el ttl
    assert.strictEqual(seen('t1:NEW_TICKET:x'), false, 'tras el ttl: vuelve a ser nueva');
  }

  console.log('OK — createRecentEventGuard');
}

main();
