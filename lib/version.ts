// Versión del cliente, HARDCODEADA (baked-at-build). NO es una env var: es un literal que se
// bumpéa a mano en cada deploy que quieras trazar. Formato: vYYYYMMDD_<semver>.
//
// Se captura en el login (se persiste en la sesión, ver useHospitalState) y se consume desde ahí:
// cada escritura transaccional la manda en el body → el endpoint la guarda en la columna `version`.
// Así se detecta quién corre un build viejo (cacheado / no recargó el deploy). También la muestra
// el badge del login y del sidebar.
//
// Al cambiar este literal cambia el hash del bundle (cache-bust). Un cliente que quedó con un build
// viejo escribe la versión vieja (o '' si es anterior a este feature) → esa es la señal buscada.
export const APP_VERSION = 'v20260820_1.2.10';
