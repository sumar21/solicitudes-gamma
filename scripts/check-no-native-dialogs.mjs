/**
 * Guardián: prohíbe los diálogos NATIVOS del navegador (alert / confirm / prompt) en el frontend.
 *
 * Se ven como un cartel de Chrome ("mediflow.sumar.dev dice…"), bloquean la pestaña y rompen el
 * diseño de la app. Para avisar a la usuaria se usa appAlert() de lib/appDialog.ts.
 * Ver docs/arquitectura/convenciones.md → "Avisos a la usuaria".
 *
 * Corre en `npm run build` (o sea, en cada deploy de Vercel) y en `npm run lint`: si encuentra un
 * uso, sale con código 1 y lista archivo:línea.
 *
 * Uso: node scripts/check-no-native-dialogs.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
// Solo el frontend (lo que corre en el navegador). api/ es serverless: no tiene diálogos.
const TARGETS = ['App.tsx', 'index.tsx', 'components', 'views', 'hooks', 'lib', 'src-sw'];
const EXT = /\.(tsx?|jsx?|mjs)$/;

// Llamada suelta (`alert(`) o calificada (`window.confirm(`). El lookbehind deja pasar métodos
// propios como `installPrompt.prompt()`.
const BARE = /(?<![\w.$])(alert|confirm|prompt)\s*\(/g;
const QUALIFIED = /\b(window|globalThis|self)\s*\.\s*(alert|confirm|prompt)\s*\(/g;

function files(path) {
  const abs = join(ROOT, path);
  let st;
  try { st = statSync(abs); } catch { return []; }
  if (st.isFile()) return EXT.test(path) ? [abs] : [];
  return readdirSync(abs).flatMap(name => files(join(path, name)));
}

// Borra comentarios conservando los saltos de línea (para reportar la línea correcta) y para no
// marcar la propia documentación de la regla.
function stripComments(src) {
  const blank = m => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)));
}

const hits = [];
for (const file of TARGETS.flatMap(files)) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const re of [BARE, QUALIFIED]) {
      re.lastIndex = 0;
      if (re.test(line)) { hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`); break; }
    }
  });
}

if (hits.length) {
  console.error('\n✖ Diálogos nativos del navegador (alert/confirm/prompt) en el frontend:\n');
  hits.forEach(h => console.error('  ' + h));
  console.error('\nUsá appAlert() de lib/appDialog.ts. Ver docs/arquitectura/convenciones.md → "Avisos a la usuaria".\n');
  process.exit(1);
}
console.log('✓ Sin diálogos nativos del navegador (alert/confirm/prompt).');
