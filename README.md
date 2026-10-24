# Tecnocore

Tienda de componentes para PC con pedidos por WhatsApp, punto de venta y entregas.

## Dónde vive cada cosa

| Pieza | Servicio | En el repo |
|---|---|---|
| Páginas | GitHub Pages (rama `main`, raíz) | `index.html`, `admin.html`, `empleado.html`, `rider.html`, `assets/`, `config.js` (compilado) |
| API | Supabase Edge Function `api` | `src/api/functions/api/` |
| Base de datos | Supabase Postgres, esquema `tc` | `src/api/schema.sql` |

Las páginas son:

- `index.html`: la tienda (catálogo, carrito, pedidos, seguimiento y soporte).
- `admin.html`: el panel de administración.
- `empleado.html`: el punto de venta.
- `rider.html`: las entregas.

La dirección de la API está en `config.js` y se puede cambiar sin recompilar.

## Desarrollo

Todo se ejecuta desde `src/`:

```sh
npm install
npm run build   # compila src/web en la raíz del repo, lista para publicar
npm test        # pruebas de la API (Bun + Postgres en localhost:54329)
```

Las pruebas crean y borran su propia base `tecnocore_test`.

## Publicar

- **Páginas:** ejecutar `npm run build` y hacer commit de lo que cambie en la raíz. GitHub Pages lo publica solo.
- **API:** desplegar `src/api/functions/api/` como la función `api` de Supabase, con `verify_jwt` desactivado, porque la API maneja sus propias sesiones.
- **Base de datos:** aplicar `src/api/schema.sql`. Se puede correr las veces que haga falta.
