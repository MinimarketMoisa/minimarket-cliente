<<<<<<< HEAD
# MiniMarket Online — Catálogo para Clientes (`minimarket-cliente`)

Tienda en línea ligera para clientes con diseño de supermercado (estilo Súper Selectos / Walmart), adaptada a la paleta oficial (`#9caa17`, `#2f6b3f`, `#f67300`) y al logotipo oficial de **MiniMarket**.

Construida **únicamente con HTML5, CSS / Tailwind CSS y JavaScript ligero**, sin Django ni dependencias de servidor local, consumiendo directamente la API de MiniMarket.

---

## Estructura de Archivos

```text
minimarket-cliente/
├── index.html               # Portada, carrusel, mega-menú, filtros laterales, detalle y carrito
├── login.html               # Inicio de sesión conectado a POST /auth/login y GET /auth/me
├── registro.html            # Creación de cuenta conectada a POST /auth/registro
├── css/
│   └── styles.css           # Estilos corporativos MiniMarket, tarjetas y animaciones de paneles
├── js/
│   └── app.js               # Consumo de API, filtros dinámicos, validaciones y carrito lateral
├── img/
│   └── logo-minimarket.png  # Logotipo oficial MiniMarket
├── cambios.md               # Informe técnico y visual de arquitectura (Markdown)
└── cambios_imprimible.html  # Versión visual lista para exportar a PDF (Ctrl + P)
```

---

## Cómo abrirlo

1. **Directo en el navegador**: haz doble clic sobre `index.html` y ábrelo en tu navegador.
2. **Con VS Code**: haz clic derecho sobre `index.html` → **Open with Live Server**.

---

## Conexión con la API

`js/app.js` consume automáticamente los endpoints de **FastAPI** (`https://minimarket-api.duckdns.org` o `http://127.0.0.1:8000`):
- `GET /categorias`, `GET /productos`, `GET /sucursales` y `GET /productos/{id}/disponibilidad`
- `POST /auth/login`, `GET /auth/me` y `POST /auth/registro`
- `POST /pedidos` (`canal = "WEB"`)

Si deseas apuntar manualmente a otra URL de la API desde la consola del navegador:
```js
localStorage.setItem("mm_api_url", "http://TU_IP_VPS:8000");
location.reload();
```
=======
# minimarket-cliente
>>>>>>> 7060f8ef0b94a14776a331ef0c09c6c0f94f1129
