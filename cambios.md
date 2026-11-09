# Informe Visual y Técnico — `minimarket-cliente` (Catálogo en Línea)

> **Proyecto:** MiniMarket Online — Tienda Web para Clientes  
> **Tecnologías:** HTML5 semántico · CSS3 + Tailwind CSS · JavaScript ligero (100 % estático)  
> **Integración:** Consumo directo de `minimarket-api` (FastAPI) + espejo local exacto (`js/datos_fastapi.js`)  
> **Estética:** Colores, tipografía `Inter` y tarjetas unificadas con `minimarket-web` (Django)

---

## 1. Arquitectura Ligera y Conexión con `minimarket-api` (FastAPI)

`minimarket-cliente` opera íntegramente desde el navegador consumiendo los endpoints reales de `minimarket-api`:
- **Catálogo e inventario:** `GET /categorias`, `GET /productos?skip=0&limit=200` (paginado completo), `GET /productos/{id}/disponibilidad`, `GET /sucursales`, `GET /municipios`.
- **Autenticación de clientes:** `POST /auth/login`, `GET /auth/me`, `POST /auth/registro`, `POST /auth/olvide-contrasena`, `POST /auth/reenviar-verificacion`.
- **Direcciones y Pedidos:** `GET /direcciones`, `POST /direcciones`, `POST /pedidos` (`RETIRO` en sucursal o `DOMICILIO` +\$1.50), `GET /pedidos/mis-pedidos`, `POST /pedidos/{id}/enviar-factura`.
- **Respaldo espejo exacto (`js/datos_fastapi.js`):** Si el servidor FastAPI local (`127.0.0.1:8000`) está apagado o la red bloquea `minimarket-api.duckdns.org` (por ejemplo, filtros FortiGuard de DNS dinámico), se cargan exactamente los **100 productos, 9 categorías, 5 sucursales de San Miguel y 4 municipios** definidos en `minimarket-api/poblar_100_productos.py` y `app/seed.py`.

---

## 2. Estética Visual Unificada con `minimarket-web` (Django)

Se alinearon todos los tokens de color, sombras, bordes y tipografía con `minimarket-web/tienda/static/tienda/empleado.css` y `base_portal.html`:

| Token / Variable | Código HEX | Aplicación en `minimarket-cliente` |
| :--- | :---: | :--- |
| **`--ink` (`mm-ink`)** | `#172b25` | Texto principal, botones de departamentos, encabezados de catálogo y franja superior del footer |
| **`--canvas` (`mm-canvas`)** | `#f4f8f5` | Fondo general de la aplicación y cajas interiores |
| **`--line` (`mm-line`)** | `#e2eae6` | Bordes suaves de tarjetas `.mm-panel` y `.super-product-card` |
| **`--green` (`mm-green`)** | `#9caa17` | Botón `Todas las Categorías`, botón de agregar al carrito `[🛒]` e indicadores activos |
| **`--green-dark` / `--green-soft`** | `#707d0c` / `#f3f5df` | Etiquetas `.mm-eyebrow`, avatares de usuario, estados activos y pastillas de departamento |
| **`--orange` (`mm-orange`)** | `#f67300` | Acciones primarias (`Confirmar pedido`, `Iniciar Sesión`, `Crear cuenta`, buscador) y borde superior `border-t-4` en tarjetas y modales |
