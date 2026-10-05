# Línea de diseño "appsdelsanto"

Estilo común para todas las apps (medidores, cfe-fotos y las que sigan).
Basado en las apps de lectura que ya funcionan en iPhone y Android.

## Colores

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#1a2033` | Fondo (azul marino oscuro) |
| `--surface` | `#232b42` | Tarjetas, botones secundarios |
| `--surface2` | `#2b3450` | Etiquetas sobre tarjetas |
| `--border` | `#3a4360` | Bordes |
| `--amber` | `#f0b142` | Acción principal, elemento enfocado, avisos |
| `--amber-dim` | `#4a3c26` | Fondo de etiquetas ámbar, resaltado de texto |
| `--text` | `#f2ebdc` | Texto (crema) |
| `--muted` | `#9aa3b8` | Texto secundario |
| `--dim` | `#6b7490` | Pistas, metadatos |

Texto sobre ámbar: `#1a2033`.

## Tipografía (de sistema, sin descargas)

- **Interfaz:** sans de sistema (San Francisco / Roboto), botones en negrita.
- **Nombres de personas y lectura:** serif (Iowan Old Style / Georgia).
- **Números y códigos** (RPU, medidor, código): monoespaciada.

## Componentes

- Botones grandes, esquinas de 14 px, borde de 1.5 px.
- **Un solo botón ámbar relleno por pantalla** (la acción principal).
  Los demás: fondo `--surface`; el secundario importante con borde ámbar.
- Etiquetas tipo "píldora" (`border-radius: 999px`) para estado y versión.
- Barra superior: `‹` atrás a la izquierda, título centrado, acción a la derecha.
- Diseño pensado para una mano en el teléfono, alto contraste para leer al sol.
