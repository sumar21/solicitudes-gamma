// Self-check del aviso de versión nueva (lib/version/actualizacion.ts).
// Correr:  npx tsx scripts/check-version.mts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { APP_VERSION, esVersionDeLaApp } from '../lib/version';
import {
  AL_DIA,
  anunciaOtraVersion,
  avisoAbierto,
  conLaRespuesta,
  ENTRE_CONSULTAS_MS,
  escribirPlazo,
  estadoInicial,
  formatearCuentaRegresiva,
  leerPlazo,
  POSTERGACION_MS,
  postergar,
  tocaPreguntar,
  tocaRecargar,
  type EstadoDeLaVersion,
} from '../lib/version/actualizacion';

const expect = (real: unknown) => ({
  toBe: (esperado: unknown) => assert.strictEqual(real, esperado),
  toEqual: (esperado: unknown) => assert.deepEqual(real, esperado),
  toBeNull: () => assert.strictEqual(real, null),
});

const AHORA = 1_800_000_000_000;
const NUEVA = 'v20991231_9.9.9';
const MAS_NUEVA = 'v21000101_10.0.0';
const VIEJA = 'v20200101_0.0.1';

function guardado(cambios: Record<string, unknown> = {}): string {
  return JSON.stringify({ en: AHORA + 60_000, version: NUEVA, desde: APP_VERSION, ...cambios });
}

describe('leerPlazo — solo se retoma una cuenta de este código, sin vencer', () => {
  it('retoma la que escribió este mismo código, para otra versión, dentro de los 10 minutos', () => {
    expect(leerPlazo(guardado(), AHORA)).toEqual({ en: AHORA + 60_000, version: NUEVA });
    expect(leerPlazo(guardado({ en: AHORA + POSTERGACION_MS }), AHORA)).toEqual({
      en: AHORA + POSTERGACION_MS,
      version: NUEVA,
    });
    expect(leerPlazo(guardado({ version: VIEJA }), AHORA)).toEqual({
      en: AHORA + 60_000,
      version: VIEJA,
    });
  });

  it('lee lo que escribe escribirPlazo', () => {
    const plazo = { en: AHORA + 1_000, version: NUEVA };
    expect(leerPlazo(escribirPlazo(plazo), AHORA)).toEqual(plazo);
  });

  const descartables: [string, string | null][] = [
    ['nada', null],
    ['un texto vacío', ''],
    ['algo que no es JSON', '{en:'],
    ['JSON null', 'null'],
    ['un número', '42'],
    ['un arreglo', '[]'],
    ['la de otro código (la recarga trajo el nuevo)', guardado({ desde: NUEVA })],
    ['una sin código', guardado({ desde: undefined })],
    ['una para esta misma versión', guardado({ version: APP_VERSION })],
    ['una versión sin formato', guardado({ version: 'latest' })],
    ['una versión sin fecha', guardado({ version: 'v1.15.2' })],
    ['sin versión', guardado({ version: undefined })],
    ['una ya vencida', guardado({ en: AHORA - 1 })],
    ['una que vence justo ahora', guardado({ en: AHORA })],
    ['una de más de 10 minutos', guardado({ en: AHORA + POSTERGACION_MS + 1 })],
    ['un plazo de texto', guardado({ en: String(AHORA + 60_000) })],
    ['un plazo que no es finito', guardado({ en: null })],
  ];
  for (const [caso, crudo] of descartables) {
    it(`descarta ${caso}`, () => {
      expect(leerPlazo(crudo, AHORA)).toBeNull();
    });
  }
});

describe('formatearCuentaRegresiva', () => {
  it('m:ss redondeado al segundo de arriba, nunca menos de 0:00', () => {
    expect(formatearCuentaRegresiva(POSTERGACION_MS)).toBe('10:00');
    expect(formatearCuentaRegresiva(581_000)).toBe('9:41');
    expect(formatearCuentaRegresiva(59_001)).toBe('1:00');
    expect(formatearCuentaRegresiva(60_000)).toBe('1:00');
    expect(formatearCuentaRegresiva(9_000)).toBe('0:09');
    expect(formatearCuentaRegresiva(1)).toBe('0:01');
    expect(formatearCuentaRegresiva(0)).toBe('0:00');
    expect(formatearCuentaRegresiva(-5_000)).toBe('0:00');
  });
});

describe('lo que cambia con cada respuesta de /api/version', () => {
  it('otra versión, más nueva o más vieja, abre el aviso', () => {
    expect(avisoAbierto(conLaRespuesta(AL_DIA, NUEVA))).toBe(true);
    expect(avisoAbierto(conLaRespuesta(AL_DIA, VIEJA))).toBe(true);
  });

  it('la misma versión no abre nada', () => {
    expect(conLaRespuesta(AL_DIA, APP_VERSION)).toBe(AL_DIA);
    expect(avisoAbierto(AL_DIA)).toBe(false);
  });

  it('sin respuesta no cambia nada, ni cierra un aviso abierto', () => {
    const abierto = conLaRespuesta(AL_DIA, NUEVA);
    expect(conLaRespuesta(abierto, null)).toBe(abierto);
    expect(conLaRespuesta(AL_DIA, null)).toBe(AL_DIA);
  });

  it('la misma versión otra vez cierra el aviso', () => {
    expect(conLaRespuesta(conLaRespuesta(AL_DIA, NUEVA), APP_VERSION)).toEqual(AL_DIA);
  });

  it('la misma respuesta dos veces no cambia el estado', () => {
    const abierto = conLaRespuesta(AL_DIA, NUEVA);
    expect(conLaRespuesta(abierto, NUEVA)).toBe(abierto);
  });
});

describe('la cuenta regresiva', () => {
  const abierto = conLaRespuesta(AL_DIA, NUEVA);

  it('«Actualizar en 10 minutos» cierra el aviso y arranca la cuenta', () => {
    const enCuenta = postergar(abierto, AHORA);
    expect(enCuenta.plazo).toEqual({ en: AHORA + POSTERGACION_MS, version: NUEVA });
    expect(avisoAbierto(enCuenta)).toBe(false);
  });

  it('sin otra versión no hay nada que postergar', () => {
    expect(postergar(AL_DIA, AHORA)).toBe(AL_DIA);
  });

  it('postergar otra vez no corre el plazo', () => {
    const enCuenta = postergar(abierto, AHORA);
    expect(postergar(enCuenta, AHORA + 60_000)).toBe(enCuenta);
  });

  it('un despliegue más mientras corre no la reinicia ni vuelve a abrir el aviso', () => {
    const enCuenta = postergar(abierto, AHORA);
    const otroMas = conLaRespuesta(enCuenta, MAS_NUEVA);
    expect(otroMas).toEqual({ desplegada: MAS_NUEVA, plazo: enCuenta.plazo });
    expect(avisoAbierto(otroMas)).toBe(false);
  });

  it('volver atrás a esta versión la cancela', () => {
    const enCuenta = postergar(abierto, AHORA);
    expect(conLaRespuesta(enCuenta, APP_VERSION)).toEqual(AL_DIA);
  });

  it('una cuenta retomada al montar sigue, sin aviso', () => {
    const plazo = { en: AHORA + 60_000, version: NUEVA };
    const retomado: EstadoDeLaVersion = estadoInicial(plazo);
    expect(retomado).toEqual({ desplegada: NUEVA, plazo });
    expect(avisoAbierto(retomado)).toBe(false);
    expect(estadoInicial(null)).toBe(AL_DIA);
  });
});

describe('tocaRecargar — a las 0:00, una vez, y nunca con trabajo a medio hacer', () => {
  const plazo = { en: AHORA, version: NUEVA };

  it('antes de vencer, no', () => {
    expect(tocaRecargar({ ahora: AHORA - 1, plazo, retenida: false, disparadaPara: null })).toBe(false);
  });

  it('al vencer, sí, y también con la pestaña que vuelve pasada la hora', () => {
    expect(tocaRecargar({ ahora: AHORA, plazo, retenida: false, disparadaPara: null })).toBe(true);
    expect(
      tocaRecargar({ ahora: AHORA + 3_600_000, plazo, retenida: false, disparadaPara: null }),
    ).toBe(true);
  });

  it('una sola vez por plazo', () => {
    expect(
      tocaRecargar({ ahora: AHORA + 5_000, plazo, retenida: false, disparadaPara: AHORA }),
    ).toBe(false);
  });

  it('con trabajo en curso espera; al liberarse, recarga', () => {
    expect(tocaRecargar({ ahora: AHORA + 5_000, plazo, retenida: true, disparadaPara: null })).toBe(false);
    expect(tocaRecargar({ ahora: AHORA + 9_000, plazo, retenida: false, disparadaPara: null })).toBe(true);
  });

  it('sin cuenta regresiva, nunca', () => {
    expect(tocaRecargar({ ahora: AHORA, plazo: null, retenida: false, disparadaPara: null })).toBe(false);
  });
});

describe('tocaPreguntar y anunciaOtraVersion', () => {
  const base = { ahora: AHORA, ultima: AHORA - ENTRE_CONSULTAS_MS, enCurso: false, visible: true };

  it('pasados 30 s, a la vista y sin otra en vuelo: sí', () => {
    expect(tocaPreguntar({ ...base, anunciada: false })).toBe(true);
  });

  it('dentro de los 30 s, no; con una versión anunciada, sí', () => {
    const reciente = { ...base, ultima: AHORA - ENTRE_CONSULTAS_MS + 1 };
    expect(tocaPreguntar({ ...reciente, anunciada: false })).toBe(false);
    expect(tocaPreguntar({ ...reciente, anunciada: true })).toBe(true);
  });

  it('nunca dos a la vez ni con la pestaña oculta', () => {
    for (const anunciada of [false, true]) {
      expect(tocaPreguntar({ ...base, enCurso: true, anunciada })).toBe(false);
      expect(tocaPreguntar({ ...base, visible: false, anunciada })).toBe(false);
    }
  });

  it('la versión de este código, o sin formato, no anuncia nada', () => {
    expect(anunciaOtraVersion(NUEVA)).toBe(true);
    expect(anunciaOtraVersion(VIEJA)).toBe(true);
    expect(anunciaOtraVersion(APP_VERSION)).toBe(false);
    for (const rara of ['latest', '', null, undefined, 42, { version: NUEVA }, `${NUEVA} `]) {
      expect(anunciaOtraVersion(rara)).toBe(false);
    }
  });
});

describe('esVersionDeLaApp — el formato vYYYYMMDD_<semver> de MediFlow', () => {
  it('la versión de este código tiene el formato', () => {
    expect(esVersionDeLaApp(APP_VERSION)).toBe(true);
  });

  it('acepta varios dígitos por posición', () => {
    expect(esVersionDeLaApp('v20261030_1.15.2')).toBe(true);
    expect(esVersionDeLaApp('v20261030_10.0.12')).toBe(true);
  });

  it('rechaza lo que no tiene el formato', () => {
    for (const rara of ['v1.15.2', 'v20261030_1.15', '20261030_1.15.2', `v20261030_1.15.2 `, 'x'.repeat(41)]) {
      expect(esVersionDeLaApp(rara)).toBe(false);
    }
  });
});
