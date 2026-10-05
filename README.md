# Medidores (MEDADYS)

PWA personal para ubicar servicios en campo: buscas por RPU, medidor, nombre o
dirección y ves la ficha del servicio, sus 5 vecinos de ruta antes y después,
su historial en otras versiones del Excel y un mapa con los 11 puntos.

Publicada en GitHub Pages: https://appsdelsanto.github.io/medidores/

## Los datos NO están en este repositorio

El repo y la página son públicos. Los datos de clientes (nombres, domicilios,
GPS) **nunca se suben aquí** (`.gitignore` bloquea `*.xlsx` y `data.json`).

Cada teléfono importa el Excel una vez desde **Biblioteca de Excels** y lo
guarda solo en el propio teléfono (IndexedDB). Funciona sin internet.

## Actualizar la base de datos

1. Descarga del sistema el Excel de servicios (como `Servicios Activos.xlsx`).
2. Pásalo al teléfono (WhatsApp, Drive, correo…).
3. En la app: 📚 → **Importar Excel**. La app detecta las columnas; revisa y toca **Importar**.
4. Cada importación queda como **versión** (con fecha). Puedes elegir cuál es la
   activa, renombrarlas o borrarlas. Si algo no aparece en la activa, la app lo
   busca en las demás (de la más nueva a la más vieja) y lo marca con ⚠.

### Columnas que reconoce

Por nombre (en cualquier orden, `.xlsx` o `.xls`): `Rpu`, `Numed`/`Medidor`,
`CodigoMed`/`Codigo`, `Nombre`/`Cliente`, `Direccion`, `CalleAd1`, `CalleAd2`,
`ColNombre`/`Colonia`, `Tarifa`, `NumCta`/`Cuenta`, `Hilos`, y coordenadas como
`X`/`Y` (el sistema llama **X a la latitud** y **Y a la longitud**; la app las
reconoce por sus valores), `Lat`/`Lon` o una sola columna `GPS` con `"lat,lon"`.
Si algo no cuadra, la pantalla de importación permite elegir la columna; la
elección se recuerda para Excels con los mismos encabezados.

### Se omiten al importar

Servicios sin tarifa, medidor, latitud/longitud (vacía o 0), nombre, dirección
o colonia, y RPU repetidos. Coordenadas a más de 100 km del centro de la base
se marcan como **GPS dudoso**.

## Versiones de la app vs. datos

- `APP_VERSION` en `js/app.js` y `sw.js` = versión del **código**. Se sube solo
  cuando cambia el comportamiento o el diseño (se ve al pie de la pantalla de inicio).
- Cambiar de datos nunca requiere nueva versión de la app.
- Cuando hay código nuevo publicado, la app muestra la barra
  **"Hay una nueva versión de la app → Actualizar"**.

## Estructura

```
index.html        pantallas (inicio, ficha, mapa, biblioteca, importar)
css/app.css       estilos (ver DISENO.md)
js/app.js         toda la lógica
sw.js             cache offline del código
vendor/           Leaflet 1.9.4 (mapa) y SheetJS 0.18.5 (lector de Excel)
```

Mapa: satélite (Esri World Imagery) o calles (OpenStreetMap) cuando hay
internet; sin señal se ven solo los puntos. Cada punto abre Google Maps.

## Probar en la PC

```bash
python -m http.server 8765
```
y abrir http://localhost:8765
