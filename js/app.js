/**
 * MiniMarket Cliente — Aplicación Frontend (HTML5 + Tailwind CSS + Vanilla JS)
 * Conectada al servidor público de producción:
 *   - API REST:   https://minimarket-api.duckdns.org
 *   - WebSockets: wss://minimarket-api.duckdns.org
 *
 * Arquitectura modular por bloques:
 *   [Bloque 01] Configuración de producción y constantes
 *   [Bloque 02] Sanitización, validaciones y utilidades
 *   [Bloque 03] Modelo de datos y normalización de productos
 *   [Bloque 04] Estado reactivo en memoria y persistencia (localStorage)
 *   [Bloque 05] Cliente HTTP REST y candidatos de servidor
 *   [Bloque 06] Carrito de compras y cálculo de totales
 *   [Bloque 07] Componentes de encabezado, sucursal y mega-menú
 *   [Bloque 08] Portada y catálogo de productos (paginación 25 por página)
 *   [Bloque 09] Modal de detalle de producto
 *   [Bloque 10] Drawer de checkout y vinculación de ubicación del cliente (GPS)
 *   [Bloque 11] Procesamiento de pedidos y pasarela de pago con tarjeta (Wompi)
 *   [Bloque 12] Modal de historial de pedidos ("Mis pedidos") y cancelación
 *   [Bloque 13] Telemetría y seguimiento en vivo con Leaflet (Esri ArcGIS World Street Map)
 *   [Bloque 14] Autenticación, inicio de sesión y registro
 *   [Bloque 15] Enlace de eventos globales e inicialización (DOMContentLoaded)
 */

(function () {
  "use strict";

  // ─── [Bloque 01] Configuración de producción y constantes ───────────────────

  const API_URL = "https://minimarket-api.duckdns.org";
  const WS_URL = "wss://minimarket-api.duckdns.org";

  const STORAGE_API_URL = "mm_api_url";
  const STORAGE_CART = "mm_cliente_carrito_v3";
  const STORAGE_AUTH = "mm_cliente_sesion_v3";
  const STORAGE_SUCURSAL = "mm_cliente_sucursal_v3";

  const PRODUCTOS_POR_PAGINA = 25;
  const COSTO_ENVIO_DOMICILIO = 1.5;
  // Pedidos con total superior a este monto (USD) deben pagarse con tarjeta (Wompi)
  const LIMITE_PAGO_TARJETA = 50;
  // Intervalo de "latido" del WebSocket de seguimiento (el repartidor transmite cada ~25 s)
  const WS_PING_MS = 25000;
  const CLAVES_COMUNES = new Set([
    "12345678",
    "password",
    "contrasena",
    "qwerty1234",
    "admin1234",
  ]);

  const SEED_CATALOGO = window.MINIMARKET_FASTAPI_SEED || {
    municipios: [],
    sucursales: [],
    categorias: [],
    productos: [],
  };

  // Limpiar cualquier configuración previa en localStorage que apuntara a localhost
  try {
    const guardada = (localStorage.getItem(STORAGE_API_URL) || "").trim();
    if (guardada.includes("127.0.0.1") || guardada.includes("localhost")) {
      localStorage.removeItem(STORAGE_API_URL);
    }
  } catch (_) {}

  function obtenerCandidatosApi() {
    const personalizada = (localStorage.getItem(STORAGE_API_URL) || "").trim();
    const lista = [
      personalizada,
      API_URL,
      "http://64.236.138.169:8000",
      "http://64.236.138.169",
      "http://127.0.0.1:8000",
      "http://localhost:8000",
    ].filter(Boolean);
    return Array.from(new Set(lista.map((u) => u.replace(/\/+$/, ""))));
  }

  // ─── [BLOQUE 02] Sanitización, validaciones y utilidades ──────────────────

  function escapar(valor) {
    return String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function limpiarTexto(valor, maxLen) {
    const limpio = String(valor ?? "").replace(/\s+/g, " ").trim();
    return maxLen ? limpio.slice(0, maxLen) : limpio;
  }

  function validarImagenUrl(url) {
    if (!url) return null;
    const limpia = String(url).trim();
    if (!limpia || limpia.length > 500) return null;
    const low = limpia.toLowerCase();
    if (low.includes("javascript:") || low.startsWith("data:")) return null;
    if (!(low.startsWith("http://") || low.startsWith("https://"))) return null;
    return limpia;
  }

  function validarEmail(email) {
    const v = String(email || "").trim().toLowerCase();
    if (v.length < 5 || v.length > 254 || !v.includes("@")) return null;
    const partes = v.split("@");
    if (!partes[0] || !partes[1] || !partes[1].includes(".")) return null;
    return v;
  }

  function validarPassword(pwd) {
    const v = String(pwd || "");
    if (v.length < 8 || v.length > 128) {
      return "La contraseña debe tener entre 8 y 128 caracteres.";
    }
    if (CLAVES_COMUNES.has(v.toLowerCase())) {
      return "La contraseña elegida es demasiado común o insegura.";
    }
    return null;
  }

  // ─── [BLOQUE 03] Modelo de datos y normalización de productos ──────────────

  const MAPA_CODIGOS_SEED = new Map(
    (SEED_CATALOGO.productos || []).map((p) => [Number(p.id_producto), p.codigo_barras])
  );

  function normalizarProducto(raw, mapaCategorias) {
    if (!raw || raw.activo === false) return null;
    const id = Number(raw.id_producto);
    const nombre = limpiarTexto(raw.nombre, 200);
    const precio = Number(raw.precio_base);
    if (!Number.isInteger(id) || id <= 0 || !nombre || !Number.isFinite(precio) || precio < 0) {
      return null;
    }
    const idCat = Number(raw.id_categoria) || 0;
    const catNombre =
      limpiarTexto(raw.categoria_nombre, 100) ||
      (mapaCategorias && mapaCategorias.get(idCat)) ||
      "Supermercado";

    const descripcion =
      limpiarTexto(raw.descripcion, 1000) ||
      `Artículo disponible en el departamento de ${catNombre} de MiniMarket.`;

    return {
      id_producto: id,
      id_categoria: idCat,
      categoria_nombre: catNombre,
      codigo_barras:
        limpiarTexto(raw.codigo_barras, 50) || MAPA_CODIGOS_SEED.get(id) || null,
      nombre: nombre,
      descripcion: descripcion,
      precio_base: Math.round(precio * 100) / 100,
      imagen_url: validarImagenUrl(raw.imagen_url),
      disponibilidad: Array.isArray(raw.disponibilidad) ? raw.disponibilidad : null,
    };
  }

  // ─── [BLOQUE 04] Estado reactivo en memoria y persistencia (localStorage) ───

  function cargarStorage(clave, defecto) {
    try {
      const txt = localStorage.getItem(clave);
      return txt ? JSON.parse(txt) : defecto;
    } catch (_) {
      return defecto;
    }
  }

  function guardarStorage(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch (_) {}
  }

  const sesionInicial = cargarStorage(STORAGE_AUTH, null);

  const estado = {
    apiBaseActiva: API_URL,
    wsBaseActiva: WS_URL,
    modoFuente: "conectando", // "online" | "respaldo"
    ultimoErrorRed: "",
    categorias: [],
    sucursales: [],
    municipios: [],
    productos: [],
    direccionesCliente: [],
    direccionesCargadas: false,

    carrito: cargarStorage(STORAGE_CART, {}),
    sesion: sesionInicial || null,
    idSucursalActiva: cargarStorage(STORAGE_SUCURSAL, null),

    // Preferencias de checkout en el drawer
    tipoEntrega: "RETIRO", // "RETIRO" | "DOMICILIO"
    metodoPago: "CONTRA_ENTREGA", // "CONTRA_ENTREGA" | "TRANSFERENCIA"
    idDireccionSeleccionada: null,
    mostrarFormNuevaDireccion: false,
    coordenadasNuevaDireccion: null, // { latitud, longitud } detectadas desde el dispositivo
    detectandoGpsDireccion: false,

    // Filtros y paginación del catálogo (25 productos por página)
    vistaActual: "inicio", // "inicio" | "catalogo"
    tituloResultado: "Todo el catálogo",
    busqueda: "",
    categoriasSeleccionadas: new Set(),
    rangosPrecioCheck: new Set(), // "u2" | "2_4" | "o4"
    precioMin: null,
    precioMax: null,
    orden: "az", // "az" | "za" | "precio_asc" | "precio_desc"
    paginaActual: 1,
    categoriaMegaActiva: null,

    // Control del cuadro de espera de verificación de correo
    timerVerificacion: null,
    timerAutoVerificacion: null,
  };

  // Inicializar con catálogo base solo si existe semilla precargada
  if (SEED_CATALOGO.productos && SEED_CATALOGO.productos.length > 0) {
    aplicarDatosCatalogo(
      SEED_CATALOGO.categorias,
      SEED_CATALOGO.productos,
      SEED_CATALOGO.sucursales,
      SEED_CATALOGO.municipios
    );
  }

  // ─── [BLOQUE 05] Cliente HTTP REST y candidatos de servidor ────────────────

  async function fetchJson(url, opciones, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
    try {
      const resp = await fetch(url, { ...(opciones || {}), signal: ctrl.signal });
      const contentType = (resp.headers.get("content-type") || "").toLowerCase();
      let data = null;
      if (contentType.includes("application/json")) {
        data = await resp.json().catch(() => null);
      } else {
        const txt = await resp.text().catch(() => "");
        try {
          data = JSON.parse(txt);
        } catch (_) {
          data = {
            detail: txt
              ? `Error del servidor (${resp.status})`
              : `Error de comunicación (${resp.status})`,
          };
        }
      }

      if (!resp.ok) {
        const detalle =
          (data && (data.detail || data.mensaje)) ||
          `Error en la solicitud (${resp.status})`;
        const textoError = Array.isArray(detalle)
          ? detalle.map((d) => d.msg || JSON.stringify(d)).join(". ")
          : typeof detalle === "string"
          ? detalle
          : JSON.stringify(detalle);
        const error = new Error(textoError);
        error.status = resp.status;
        throw error;
      }
      return data;
    } catch (err) {
      if (err && err.status) {
        throw err;
      }
      const netErr = new Error(
        "Problemas de conexión con el servidor. Verifica tu conexión a internet e inténtalo nuevamente."
      );
      netErr.esErrorRed = true;
      throw netErr;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Realiza una petición priorizando siempre https://minimarket-api.duckdns.org.
   * Solo si ocurre un fallo de red puro prueba el siguiente candidato.
   */
  async function peticionApi(ruta, opciones, timeoutMs) {
    const rutaNormalizada = ruta.startsWith("/") ? ruta : `/${ruta}`;
    const candidatos =
      estado.modoFuente === "online" && estado.apiBaseActiva
        ? Array.from(new Set([estado.apiBaseActiva, ...obtenerCandidatosApi()]))
        : obtenerCandidatosApi();
    let ultimoError = null;

    for (const base of candidatos) {
      const esLocal = base.includes("127.0.0.1") || base.includes("localhost");
      const tiempo = esLocal ? 1500 : timeoutMs || 8000;
      try {
        const resultado = await fetchJson(
          `${base}${rutaNormalizada}`,
          opciones,
          tiempo
        );
        estado.apiBaseActiva = base;
        estado.modoFuente = "online";
        return resultado;
      } catch (err) {
        ultimoError = err;
        // Si el servidor respondió con un código HTTP (400, 401, 403, 404, 409, 422), no cambiar de servidor
        if (err && err.status) {
          throw err;
        }
      }
    }

    throw (
      ultimoError ||
      new Error(
        "Problemas de conexión con el servidor. Inténtalo nuevamente en unos momentos."
      )
    );
  }

  /**
   * Petición SIN reintentos en otros servidores. Se usa para operaciones que no deben
   * duplicarse (crear pedido, cobrar con tarjeta): un reintento podría registrar dos veces la acción.
   */
  async function peticionApiUnica(ruta, opciones, timeoutMs) {
    const base = String(estado.apiBaseActiva || API_URL).replace(/\/+$/, "");
    const rutaNormalizada = ruta.startsWith("/") ? ruta : `/${ruta}`;
    return fetchJson(`${base}${rutaNormalizada}`, opciones, timeoutMs || 30000);
  }

  async function cargarTodosLosProductosServidor(baseUrl) {
    const acumulado = [];
    let skip = 0;
    const limit = 200;
    for (let pagina = 0; pagina < 10; pagina++) {
      const lote = await fetchJson(
        `${baseUrl}/productos?skip=${skip}&limit=${limit}`,
        null,
        10000
      );
      if (!Array.isArray(lote)) {
        throw new Error("Formato de catálogo no válido.");
      }
      acumulado.push(...lote);
      if (lote.length < limit) break;
      skip += limit;
    }
    return acumulado;
  }

  async function inicializarDatosAPI() {
    const candidatos = obtenerCandidatosApi();
    const errores = [];

    for (const base of candidatos) {
      const esLocal = base.includes("127.0.0.1") || base.includes("localhost");
      const timeout = esLocal ? 2000 : 9000;
      try {
        const cats = await fetchJson(`${base}/categorias`, null, timeout);
        if (!Array.isArray(cats)) {
          throw new Error("Respuesta inválida en /categorias");
        }
        const [prods, sucs, munis] = await Promise.all([
          cargarTodosLosProductosServidor(base),
          fetchJson(`${base}/sucursales`, null, 7000).catch(() => []),
          fetchJson(`${base}/municipios`, null, 7000).catch(() => []),
        ]);

        estado.apiBaseActiva = base;
        estado.modoFuente = "online";
        estado.ultimoErrorRed = "";
        aplicarDatosCatalogo(cats, prods, sucs, munis);
        sincronizarCarritoConCatalogoActivo();
        return;
      } catch (err) {
        errores.push(`${base}: ${err.message || "sin respuesta"}`);
      }
    }

    estado.modoFuente = "respaldo";
    estado.ultimoErrorRed = errores.join(" | ");
  }

  function aplicarDatosCatalogo(catsRaw, prodsRaw, sucsRaw, munisRaw) {
    const mapaCats = new Map();
    estado.categorias = (Array.isArray(catsRaw) ? catsRaw : [])
      .map((c) => {
        const id = Number(c.id_categoria);
        const nombre = limpiarTexto(c.nombre, 100);
        if (!id || !nombre) return null;
        mapaCats.set(id, nombre);
        return {
          id_categoria: id,
          nombre: nombre,
          descripcion: limpiarTexto(c.descripcion, 400),
        };
      })
      .filter(Boolean);

    estado.municipios = (Array.isArray(munisRaw) && munisRaw.length > 0
      ? munisRaw
      : SEED_CATALOGO.municipios
    )
      .map((m) => ({
        id_municipio: Number(m.id_municipio),
        nombre: limpiarTexto(m.nombre, 100),
      }))
      .filter((m) => m.id_municipio > 0 && m.nombre);

    estado.sucursales = (Array.isArray(sucsRaw) && sucsRaw.length > 0
      ? sucsRaw
      : SEED_CATALOGO.sucursales
    )
      .map((s) => ({
        id_sucursal: Number(s.id_sucursal),
        id_municipio: Number(s.id_municipio) || 1,
        nombre: limpiarTexto(s.nombre, 100),
        direccion: limpiarTexto(s.direccion, 250),
        telefono: limpiarTexto(s.telefono, 30),
      }))
      .filter((s) => s.id_sucursal > 0 && s.nombre);

    if (
      !estado.idSucursalActiva ||
      !estado.sucursales.some((s) => s.id_sucursal === Number(estado.idSucursalActiva))
    ) {
      if (estado.sucursales.length > 0) {
        estado.idSucursalActiva = estado.sucursales[0].id_sucursal;
      }
    }

    estado.productos = (Array.isArray(prodsRaw) ? prodsRaw : [])
      .map((p) => normalizarProducto(p, mapaCats))
      .filter(Boolean);

    estado.productos.forEach((p) => {
      if (p.id_categoria && !mapaCats.has(p.id_categoria)) {
        mapaCats.set(p.id_categoria, p.categoria_nombre);
        estado.categorias.push({
          id_categoria: p.id_categoria,
          nombre: p.categoria_nombre,
          descripcion: "",
        });
      }
    });
  }

  /**
   * Si el usuario tenía productos en el carrito y el catálogo del servidor tiene IDs actualizados,
   * sincroniza cada artículo por id_producto o por nombre para evitar errores 404 al confirmar el pedido.
   */
  function sincronizarCarritoConCatalogoActivo() {
    if (!estado.productos || estado.productos.length === 0) return;
    const porId = new Map(estado.productos.map((p) => [Number(p.id_producto), p]));
    const porNombre = new Map(
      estado.productos.map((p) => [p.nombre.toLowerCase(), p])
    );

    const nuevoCarrito = {};
    Object.entries(estado.carrito).forEach(([idTxt, item]) => {
      const cant =
        typeof item === "object" ? Number(item.cantidad) : Number(item);
      if (!cant || cant <= 0) return;

      let prodReal = porId.get(Number(idTxt));
      if (!prodReal && typeof item === "object" && item.nombre) {
        prodReal = porNombre.get(String(item.nombre).toLowerCase());
      }
      if (!prodReal) {
        prodReal = typeof item === "object" ? item : null;
      }
      if (!prodReal) return;

      const clave = String(prodReal.id_producto);
      const existente = nuevoCarrito[clave] ? nuevoCarrito[clave].cantidad : 0;
      nuevoCarrito[clave] = {
        id_producto: prodReal.id_producto,
        nombre: prodReal.nombre,
        precio_base: Number(prodReal.precio_base),
        imagen_url: prodReal.imagen_url || null,
        cantidad: Math.min(1000, existente + cant),
      };
    });

    estado.carrito = nuevoCarrito;
    guardarStorage(STORAGE_CART, estado.carrito);
  }

  // ─── [BLOQUE 06] Carrito de compras y cálculo de totales ───────────────────

  function calcularTotalesCarrito() {
    const mapaProd = new Map(estado.productos.map((p) => [String(p.id_producto), p]));
    let unidades = 0;
    let subtotal = 0;
    const lineas = [];

    Object.entries(estado.carrito).forEach(([idTxt, itemGuardado]) => {
      const cant =
        typeof itemGuardado === "object"
          ? Number(itemGuardado.cantidad)
          : Number(itemGuardado);
      if (!cant || cant <= 0) return;
      const prod =
        mapaProd.get(idTxt) ||
        (typeof itemGuardado === "object" ? itemGuardado : null);
      if (!prod) return;
      const precio = Number(prod.precio_base) || 0;
      const lineaSub = Math.round(precio * cant * 100) / 100;
      unidades += cant;
      subtotal += lineaSub;
      lineas.push({
        id_producto: Number(prod.id_producto || idTxt),
        nombre: prod.nombre,
        precio_base: precio,
        imagen_url: prod.imagen_url || null,
        cantidad: cant,
        subtotal: lineaSub,
      });
    });

    subtotal = Math.round(subtotal * 100) / 100;
    const costoEnvio =
      lineas.length > 0 && estado.tipoEntrega === "DOMICILIO"
        ? COSTO_ENVIO_DOMICILIO
        : 0;
    const total = Math.round((subtotal + costoEnvio) * 100) / 100;

    return {
      unidades,
      subtotal,
      costoEnvio,
      total,
      lineas,
    };
  }

  function guardarCarrito() {
    guardarStorage(STORAGE_CART, estado.carrito);
    renderizarResumenHeaderCarrito();
    renderizarDrawerCarrito();
  }

  function agregarAlCarrito(idProducto, cantidadSumar) {
    const prod = estado.productos.find((p) => p.id_producto === Number(idProducto));
    if (!prod) return;
    const delta = Math.max(1, Math.min(1000, parseInt(cantidadSumar, 10) || 1));
    const clave = String(prod.id_producto);
    const actual = estado.carrito[clave]
      ? Number(estado.carrito[clave].cantidad || estado.carrito[clave])
      : 0;
    const nueva = Math.min(1000, actual + delta);
    estado.carrito[clave] = {
      id_producto: prod.id_producto,
      nombre: prod.nombre,
      precio_base: prod.precio_base,
      imagen_url: prod.imagen_url,
      cantidad: nueva,
    };
    guardarCarrito();
    mostrarToast(`Agregado al carrito: ${prod.nombre}`);
  }

  function cambiarCantidadCarrito(idProducto, nuevaCantidad) {
    const clave = String(idProducto);
    const cant = parseInt(nuevaCantidad, 10) || 0;
    if (cant <= 0) {
      delete estado.carrito[clave];
    } else if (estado.carrito[clave]) {
      if (typeof estado.carrito[clave] === "object") {
        estado.carrito[clave].cantidad = Math.min(1000, cant);
      } else {
        estado.carrito[clave] = cant;
      }
    }
    guardarCarrito();
  }

  function renderizarResumenHeaderCarrito() {
    const { subtotal, unidades } = calcularTotalesCarrito();
    const elTotal = document.getElementById("header-cart-total");
    const elBadge = document.getElementById("header-cart-badge");
    if (elTotal) elTotal.textContent = `$${subtotal.toFixed(2)}`;
    if (elBadge) {
      elBadge.textContent = String(unidades);
      elBadge.classList.toggle("hidden", unidades <= 0);
    }
  }

  function renderizarSesionHeader() {
    const elTexto = document.getElementById("header-auth-label");
    const elLink = document.getElementById("header-auth-link");
    const elAvatar = document.getElementById("header-user-avatar");
    const elIcon = document.getElementById("header-user-icon");
    const btnSalir = document.getElementById("header-logout-btn");
    const btnPedidos = document.getElementById("header-orders-btn");
    if (!elTexto || !elLink) return;

    if (estado.sesion && estado.sesion.nombre && estado.sesion.token) {
      const primerNombre = estado.sesion.nombre.split(" ")[0];
      elTexto.innerHTML = `<span class="block text-[11px] font-normal text-[#68706c] leading-tight">Hola, ${escapar(
        primerNombre
      )}</span><span class="font-bold text-[#1f2421]">Mi cuenta</span>`;
      elLink.setAttribute("href", "#");
      elLink.onclick = (e) => {
        e.preventDefault();
        abrirModalMisPedidos();
      };
      if (elAvatar) elAvatar.classList.add("hidden");
      if (elIcon) elIcon.classList.remove("hidden");
      if (btnSalir) btnSalir.classList.remove("hidden");
      if (btnPedidos) btnPedidos.classList.remove("hidden");
    } else {
      elTexto.innerHTML = `<span class="block text-[11px] font-normal text-[#68706c] leading-tight">Hola,</span><span class="font-bold text-[#1f2421]">Inicia sesión ▾</span>`;
      elLink.setAttribute("href", "login.html");
      elLink.onclick = null;
      if (elAvatar) elAvatar.classList.add("hidden");
      if (elIcon) elIcon.classList.remove("hidden");
      if (btnSalir) btnSalir.classList.add("hidden");
      if (btnPedidos) btnPedidos.classList.add("hidden");
    }
  }

  function renderizarSucursalHeader() {
    const select = document.getElementById("header-sucursal-select");
    if (!select || estado.sucursales.length === 0) return;
    select.innerHTML = estado.sucursales
      .map(
        (s) =>
          `<option value="${s.id_sucursal}" ${
            Number(estado.idSucursalActiva) === s.id_sucursal ? "selected" : ""
          }>${escapar(s.nombre)}</option>`
      )
      .join("");
  }

  // ─── [BLOQUE 07] Componentes de encabezado, sucursales y mega-menú ─────────

  function renderizarBarraCategorias() {
    const contenedor = document.getElementById("top-category-tiles");
    if (!contenedor) return;

    const catsMostrar = estado.categorias.slice(0, 6);
    const htmlTiles = catsMostrar
      .map((cat) => {
        const activa =
          estado.vistaActual === "catalogo" &&
          estado.categoriasSeleccionadas.size === 1 &&
          estado.categoriasSeleccionadas.has(cat.id_categoria);
        return `
          <button type="button"
                  data-cat-tile="${cat.id_categoria}"
                  class="cat-tile cat-tile-pill ${
                    activa ? "active" : ""
                  } flex h-11 min-w-[148px] flex-1 items-center justify-center gap-2 px-3.5 text-center text-xs font-bold">
            <span class="cat-dot"></span>
            <span class="truncate">${escapar(cat.nombre)}</span>
          </button>
        `;
      })
      .join("");

    contenedor.innerHTML = `
      <button type="button"
              id="btn-todas-categorias"
              class="cat-tile cat-tile-brand flex h-11 min-w-[178px] shrink-0 items-center justify-center gap-2.5 px-4 text-left text-xs font-extrabold leading-tight">
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </span>
        <span>Todas las<br>Categorías (${estado.categorias.length})</span>
      </button>
      ${htmlTiles}
    `;

    const btnTodas = document.getElementById("btn-todas-categorias");
    if (btnTodas) {
      btnTodas.addEventListener("click", alternarMegaMenu);
    }

    contenedor.querySelectorAll("[data-cat-tile]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idCat = Number(btn.getAttribute("data-cat-tile"));
        irACategoria(idCat);
      });
    });
  }

  function irACategoria(idCat) {
    if (!document.getElementById("vista-inicio")) {
      window.location.href = `index.html?categoria=${encodeURIComponent(idCat)}`;
      return;
    }
    cerrarMegaMenu();
    const cat = estado.categorias.find((c) => c.id_categoria === idCat);
    estado.vistaActual = "catalogo";
    estado.busqueda = "";
    estado.paginaActual = 1;
    estado.categoriasSeleccionadas = new Set([idCat]);
    estado.tituloResultado = cat
      ? `Departamento: ${cat.nombre}`
      : "Resultado por categoría";
    const inputQ = document.getElementById("header-search-input");
    if (inputQ) inputQ.value = "";
    actualizarVistasIndex();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function abrirTodoElCatalogo() {
    if (!document.getElementById("vista-inicio")) {
      window.location.href = "index.html?catalogo=1";
      return;
    }
    cerrarMegaMenu();
    estado.vistaActual = "catalogo";
    estado.busqueda = "";
    estado.paginaActual = 1;
    estado.categoriasSeleccionadas.clear();
    estado.tituloResultado = `Catálogo completo (${estado.productos.length} productos)`;
    actualizarVistasIndex();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Mega-menú "Todas las Categorías" ───────────────────────────────────────

  function alternarMegaMenu() {
    const menu = document.getElementById("mega-menu-categorias");
    if (!menu) {
      window.location.href = "index.html?ver=categorias";
      return;
    }
    const abierto = !menu.classList.contains("hidden");
    if (abierto) {
      cerrarMegaMenu();
    } else {
      if (!estado.categoriaMegaActiva && estado.categorias.length > 0) {
        estado.categoriaMegaActiva = estado.categorias[0].id_categoria;
      }
      renderizarContenidoMegaMenu();
      menu.classList.remove("hidden");
    }
  }

  function cerrarMegaMenu() {
    const menu = document.getElementById("mega-menu-categorias");
    if (menu) menu.classList.add("hidden");
  }

  function renderizarContenidoMegaMenu() {
    const listaIzq = document.getElementById("mega-menu-lista");
    const tituloDer = document.getElementById("mega-menu-titulo-cat");
    const gridDer = document.getElementById("mega-menu-subgrid");
    if (!listaIzq || !tituloDer || !gridDer) return;

    const catActiva =
      estado.categorias.find((c) => c.id_categoria === estado.categoriaMegaActiva) ||
      estado.categorias[0];

    listaIzq.innerHTML = estado.categorias
      .map((c) => {
        const esActiva = catActiva && c.id_categoria === catActiva.id_categoria;
        const conteo = estado.productos.filter((p) => p.id_categoria === c.id_categoria).length;
        return `
          <li>
            <button type="button"
                    data-mega-cat="${c.id_categoria}"
                    class="flex w-full items-center justify-between px-5 py-3 text-left text-sm transition ${
                      esActiva
                        ? "bg-[#fff3e6] font-bold text-[#d95b00] shadow-[inset_3px_0_0_#f67300]"
                        : "text-[#1f2421] hover:bg-[#faf8f5]"
                    }">
              <span>${escapar(c.nombre)}</span>
              <span class="flex items-center gap-1.5 text-xs text-[#68706c]">
                <span>${conteo}</span>
                <span>›</span>
              </span>
            </button>
          </li>
        `;
      })
      .join("");

    if (catActiva) {
      tituloDer.textContent = catActiva.nombre;
      const prodsDeCat = estado.productos.filter(
        (p) => p.id_categoria === catActiva.id_categoria
      );
      gridDer.innerHTML = `
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2dc] pb-3">
          <p class="text-xs text-[#68706c]">${escapar(
            catActiva.descripcion ||
              "Explora los productos disponibles en este departamento de MiniMarket."
          )}</p>
          <button type="button"
                  id="mega-ver-todo-cat"
                  class="mm-btn-primary shrink-0 px-3.5 py-1.5 text-xs">
            Ver departamento (${prodsDeCat.length})
          </button>
        </div>
        <div class="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          ${
            prodsDeCat.length > 0
              ? prodsDeCat
                  .slice(0, 9)
                  .map(
                    (p) => `
                    <button type="button"
                            data-mega-prod="${p.id_producto}"
                            class="group flex items-center gap-3 rounded-xl border border-transparent p-2 text-left transition hover:border-[#ffd8b5] hover:bg-[#fff8f0]">
                      <div class="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[#e8e2dc] bg-white p-1">
                        ${
                          p.imagen_url
                            ? `<img src="${escapar(
                                p.imagen_url
                              )}" alt="" class="h-full w-full rounded object-cover" onerror="this.style.display='none'">`
                            : ""
                        }
                      </div>
                      <div class="min-w-0">
                        <div class="truncate text-xs font-semibold text-[#1f2421] group-hover:text-[#d95b00]">${escapar(
                          p.nombre
                        )}</div>
                        <div class="mt-0.5 text-xs font-extrabold text-[#f67300]">$${p.precio_base.toFixed(
                          2
                        )}</div>
                      </div>
                    </button>
                  `
                  )
                  .join("")
              : `<p class="text-xs text-[#68706c]">Sin productos activos en esta categoría.</p>`
          }
        </div>
      `;

      const btnVerTodo = document.getElementById("mega-ver-todo-cat");
      if (btnVerTodo) {
        btnVerTodo.addEventListener("click", () => irACategoria(catActiva.id_categoria));
      }
      gridDer.querySelectorAll("[data-mega-prod]").forEach((b) => {
        b.addEventListener("click", () => {
          cerrarMegaMenu();
          abrirModalDetalleProducto(Number(b.getAttribute("data-mega-prod")));
        });
      });
    }

    listaIzq.querySelectorAll("[data-mega-cat]").forEach((btn) => {
      const id = Number(btn.getAttribute("data-mega-cat"));
      btn.addEventListener("mouseenter", () => {
        estado.categoriaMegaActiva = id;
        renderizarContenidoMegaMenu();
      });
      btn.addEventListener("click", () => irACategoria(id));
    });
  }

  // ─── [BLOQUE 08] Portada, catálogo de productos y filtros (25 prod/pág) ────

  function htmlTarjetaProducto(prod) {
    return `
      <article class="super-product-card flex flex-col justify-between p-3.5">
        <div>
          <!-- Fila superior: departamento con pastilla cálida naranja -->
          <div class="mb-2 flex min-h-[22px] items-center justify-between gap-1">
            <span class="truncate rounded-md border border-[#ffd8b5] bg-[#fff3e6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#d95b00]">
              ${escapar(prod.categoria_nombre)}
            </span>
          </div>

          <!-- Imagen del producto (clic abre modal de detalle y stock) -->
          <button type="button"
                  data-open-detail="${prod.id_producto}"
                  class="mb-3 flex h-40 w-full items-center justify-center overflow-hidden rounded-xl bg-[#faf8f5] focus:outline-none">
            ${
              prod.imagen_url
                ? `
                  <img src="${escapar(prod.imagen_url)}"
                       alt="${escapar(prod.nombre)}"
                       loading="lazy"
                       class="h-full w-full object-cover transition duration-200 hover:scale-105"
                       onerror="this.onerror=null;this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden');">
                  <div class="img-placeholder-box hidden h-36 w-full">Sin imagen</div>
                `
                : `<div class="img-placeholder-box h-36 w-full">Sin imagen</div>`
            }
          </button>

          <!-- Precio base -->
          <div class="flex items-baseline justify-between gap-1">
            <span class="text-lg font-extrabold tracking-tight text-[#1f2421]">$${prod.precio_base.toFixed(
              2
            )}</span>
            <span class="text-[11px] font-medium text-[#68706c]">Ver detalle</span>
          </div>

          <!-- Nombre y extracto de descripción -->
          <button type="button"
                  data-open-detail="${prod.id_producto}"
                  class="clamp-2 mt-1 min-h-[2.2rem] text-left text-xs font-bold leading-snug text-[#1f2421] hover:text-[#f67300]">
            ${escapar(prod.nombre)}
          </button>
          <p class="clamp-2 mt-1 min-h-[1.9rem] text-[11px] leading-snug text-[#68706c]">
            ${escapar(prod.descripcion)}
          </p>
        </div>

        <!-- Controles − 1 + y botón naranja MiniMarket de agregar -->
        <div class="mt-3.5 flex items-center gap-2" data-card-controls="${prod.id_producto}">
          <div class="flex flex-1 items-center justify-between rounded-lg border border-[#e8e2dc] bg-[#faf8f5] px-2.5 py-1.5 text-xs">
            <button type="button" data-step="-1" class="px-1 font-bold text-[#68706c] hover:text-[#1f2421]">−</button>
            <input type="number"
                   value="1"
                   min="1"
                   max="999"
                   aria-label="Cantidad"
                   class="qty-field w-10 bg-transparent text-center text-xs font-bold text-[#1f2421] focus:outline-none">
            <button type="button" data-step="1" class="px-1 font-bold text-[#68706c] hover:text-[#1f2421]">+</button>
          </div>
          <button type="button"
                  data-add-cart="${prod.id_producto}"
                  aria-label="Agregar al carrito"
                  class="mm-btn-green flex h-8 w-12 shrink-0 items-center justify-center">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 6h12m-9 0a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z"/>
            </svg>
          </button>
        </div>
      </article>
    `;
  }

  function enlazarEventosTarjetas(contenedor) {
    if (!contenedor) return;

    contenedor.querySelectorAll("[data-open-detail]").forEach((el) => {
      el.addEventListener("click", () => {
        abrirModalDetalleProducto(Number(el.getAttribute("data-open-detail")));
      });
    });

    contenedor.querySelectorAll("[data-card-controls]").forEach((box) => {
      const input = box.querySelector(".qty-field");
      box.querySelectorAll("[data-step]").forEach((bStep) => {
        bStep.addEventListener("click", () => {
          const delta = Number(bStep.getAttribute("data-step"));
          const actual = parseInt(input.value, 10) || 1;
          input.value = Math.max(1, Math.min(999, actual + delta));
        });
      });
      const btnAdd = box.querySelector("[data-add-cart]");
      if (btnAdd) {
        btnAdd.addEventListener("click", () => {
          const cant = parseInt(input.value, 10) || 1;
          agregarAlCarrito(Number(btnAdd.getAttribute("data-add-cart")), cant);
          input.value = 1;
        });
      }
    });
  }

  // ─── Portada y Catálogo paginado de 25 en 25 productos ──────────────────────

  function renderizarInicio() {
    const gridDestacadas = document.getElementById("home-featured-categories");
    const filaGeneral = document.getElementById("home-all-products");

    if (gridDestacadas) {
      const ordenPreferido = [
        "bebida",
        "abarrote",
        "lácteo",
        "snack",
        "fruta",
        "cuidado personal",
      ];
      const elegidas = [];
      ordenPreferido.forEach((clave) => {
        const cat = estado.categorias.find(
          (c) =>
            c.nombre.toLowerCase().includes(clave) &&
            !elegidas.some((e) => e.id_categoria === c.id_categoria)
        );
        if (cat) elegidas.push(cat);
      });
      estado.categorias.forEach((c) => {
        if (elegidas.length < 6 && !elegidas.some((e) => e.id_categoria === c.id_categoria)) {
          elegidas.push(c);
        }
      });

      gridDestacadas.innerHTML = elegidas
        .slice(0, 6)
        .map((cat) => {
          const prodsCat = estado.productos.filter(
            (p) => p.id_categoria === cat.id_categoria
          );
          const prodPortada = prodsCat.find((p) => p.imagen_url);
          const imgPortada = prodPortada ? prodPortada.imagen_url : "";
          return `
            <button type="button"
                    data-feat-cat="${cat.id_categoria}"
                    class="group relative h-52 overflow-hidden rounded-2xl border border-[#e8e2dc] bg-[#1f2421] text-left shadow-sm transition hover:-translate-y-1 hover:border-[#f67300] hover:shadow-lg">
              ${
                imgPortada
                  ? `<img src="${escapar(
                      imgPortada
                    )}" alt="${escapar(
                      cat.nombre
                    )}" loading="lazy" class="h-full w-full object-cover opacity-80 transition duration-300 group-hover:scale-105">`
                  : ""
              }
              <div class="absolute inset-0 bg-gradient-to-t from-[#1f2421]/95 via-[#1f2421]/40 to-transparent"></div>
              <div class="absolute inset-x-3.5 bottom-3.5">
                <span class="inline-block rounded-full bg-[#f67300] px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                  ${prodsCat.length} productos
                </span>
                <span class="mt-1.5 block text-sm font-extrabold leading-tight text-white">
                  ${escapar(cat.nombre)}
                </span>
              </div>
            </button>
          `;
        })
        .join("");

      gridDestacadas.querySelectorAll("[data-feat-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          irACategoria(Number(btn.getAttribute("data-feat-cat")));
        });
      });
    }

    // Mostrar 25 productos en la portada (5 filas x 5 columnas)
    if (filaGeneral) {
      const variados = [];
      estado.categorias.forEach((cat) => {
        const prodsCat = estado.productos.filter((p) => p.id_categoria === cat.id_categoria);
        prodsCat.slice(0, 3).forEach((prod) => {
          if (variados.length < PRODUCTOS_POR_PAGINA && !variados.some((v) => v.id_producto === prod.id_producto)) {
            variados.push(prod);
          }
        });
      });
      for (const p of estado.productos) {
        if (variados.length >= PRODUCTOS_POR_PAGINA) break;
        if (!variados.some((v) => v.id_producto === p.id_producto)) {
          variados.push(p);
        }
      }
      filaGeneral.innerHTML = variados
        .slice(0, PRODUCTOS_POR_PAGINA)
        .map(htmlTarjetaProducto)
        .join("");
      enlazarEventosTarjetas(filaGeneral);
    }

    const btnVerTodo = document.getElementById("btn-ver-todo-catalogo");
    if (btnVerTodo) {
      btnVerTodo.textContent = `Ver catálogo completo (${estado.productos.length} productos) →`;
      btnVerTodo.onclick = abrirTodoElCatalogo;
    }
  }

  function obtenerProductosFiltrados() {
    let lista = estado.productos.slice();

    if (estado.categoriasSeleccionadas.size > 0) {
      lista = lista.filter((p) => estado.categoriasSeleccionadas.has(p.id_categoria));
    }
    if (estado.busqueda) {
      const q = estado.busqueda.toLowerCase();
      lista = lista.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.descripcion.toLowerCase().includes(q) ||
          p.categoria_nombre.toLowerCase().includes(q) ||
          (p.codigo_barras && p.codigo_barras.includes(q))
      );
    }

    if (estado.rangosPrecioCheck.size > 0) {
      lista = lista.filter((p) => {
        const val = p.precio_base;
        if (estado.rangosPrecioCheck.has("u2") && val < 2) return true;
        if (estado.rangosPrecioCheck.has("2_4") && val >= 2 && val <= 4) return true;
        if (estado.rangosPrecioCheck.has("o4") && val > 4) return true;
        return false;
      });
    }

    if (estado.precioMin !== null) {
      lista = lista.filter((p) => p.precio_base >= estado.precioMin);
    }
    if (estado.precioMax !== null) {
      lista = lista.filter((p) => p.precio_base <= estado.precioMax);
    }

    if (estado.orden === "za") {
      lista.sort((a, b) => b.nombre.localeCompare(a.nombre, "es"));
    } else if (estado.orden === "precio_asc") {
      lista.sort((a, b) => a.precio_base - b.precio_base);
    } else if (estado.orden === "precio_desc") {
      lista.sort((a, b) => b.precio_base - a.precio_base);
    } else {
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    }

    return lista;
  }

  function renderizarSidebarFiltros() {
    const listaCats = document.getElementById("filter-categories-list");
    if (listaCats) {
      listaCats.innerHTML = estado.categorias
        .map((c) => {
          const cantidad = estado.productos.filter(
            (p) => p.id_categoria === c.id_categoria
          ).length;
          return `
            <label class="flex cursor-pointer items-center justify-between gap-2 text-xs text-[#1f2421] hover:text-[#d95b00]">
              <span class="flex items-center gap-2.5 min-w-0">
                <input type="checkbox"
                       data-filter-cat="${c.id_categoria}"
                       ${estado.categoriasSeleccionadas.has(c.id_categoria) ? "checked" : ""}
                       class="super-checkbox">
                <span class="truncate">${escapar(c.nombre)}</span>
              </span>
              <span class="rounded-full bg-[#fff3e6] px-2 py-0.5 text-[10px] font-bold text-[#d95b00]">${cantidad}</span>
            </label>
          `;
        })
        .join("");

      listaCats.querySelectorAll("[data-filter-cat]").forEach((chk) => {
        chk.addEventListener("change", () => {
          const id = Number(chk.getAttribute("data-filter-cat"));
          if (chk.checked) estado.categoriasSeleccionadas.add(id);
          else estado.categoriasSeleccionadas.delete(id);
          estado.paginaActual = 1;
          renderizarResultadosCatalogo();
          renderizarBarraCategorias();
        });
      });
    }

    document.querySelectorAll("[data-price-bucket]").forEach((chk) => {
      chk.checked = estado.rangosPrecioCheck.has(chk.getAttribute("data-price-bucket"));
    });
  }

  function renderizarResultadosCatalogo() {
    const tituloBanner = document.getElementById("catalog-banner-title");
    const contadorBanner = document.getElementById("catalog-results-count");
    const grid = document.getElementById("catalog-results-grid");
    const paginador = document.getElementById("catalog-pagination");
    const vacio = document.getElementById("catalog-empty-state");
    if (!grid || !tituloBanner) return;

    if (estado.busqueda) {
      tituloBanner.textContent = `Resultados para "${estado.busqueda}"`;
    } else if (estado.categoriasSeleccionadas.size === 1) {
      const unicoId = Array.from(estado.categoriasSeleccionadas)[0];
      const cat = estado.categorias.find((c) => c.id_categoria === unicoId);
      tituloBanner.textContent = cat
        ? `Departamento: ${cat.nombre}`
        : estado.tituloResultado;
    } else {
      tituloBanner.textContent =
        estado.tituloResultado || `Catálogo completo (${estado.productos.length} productos)`;
    }

    const filtrados = obtenerProductosFiltrados();
    const totalItems = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(totalItems / PRODUCTOS_POR_PAGINA));

    if (estado.paginaActual > totalPaginas) {
      estado.paginaActual = totalPaginas;
    }
    if (estado.paginaActual < 1) {
      estado.paginaActual = 1;
    }

    const inicioIdx = (estado.paginaActual - 1) * PRODUCTOS_POR_PAGINA;
    const finIdx = Math.min(inicioIdx + PRODUCTOS_POR_PAGINA, totalItems);
    const itemsPagina = filtrados.slice(inicioIdx, finIdx);

    if (contadorBanner) {
      if (totalItems === 0) {
        contadorBanner.textContent = "Mostrando 0 productos";
      } else {
        contadorBanner.textContent = `Mostrando ${inicioIdx + 1}–${finIdx} de ${totalItems} productos (Página ${estado.paginaActual} de ${totalPaginas})`;
      }
    }

    if (totalItems === 0) {
      grid.innerHTML = "";
      if (paginador) paginador.innerHTML = "";
      if (vacio) vacio.classList.remove("hidden");
    } else {
      if (vacio) vacio.classList.add("hidden");
      grid.innerHTML = itemsPagina.map(htmlTarjetaProducto).join("");
      enlazarEventosTarjetas(grid);
      renderizarControlesPaginacion(paginador, totalItems, totalPaginas, inicioIdx, finIdx);
    }
  }

  function renderizarControlesPaginacion(contenedor, totalItems, totalPaginas, inicioIdx, finIdx) {
    if (!contenedor) return;

    const botonesNumeros = [];
    for (let p = 1; p <= totalPaginas; p++) {
      botonesNumeros.push(`
        <button type="button"
                data-page-num="${p}"
                class="mm-page-btn ${p === estado.paginaActual ? "active" : ""}">
          ${p}
        </button>
      `);
    }

    contenedor.innerHTML = `
      <span class="text-xs font-medium text-[#68706c]">
        Mostrando <strong class="text-[#1f2421]">${inicioIdx + 1}–${finIdx}</strong> de <strong class="text-[#1f2421]">${totalItems}</strong> productos (25 por página)
      </span>
      <div class="flex flex-wrap items-center gap-1.5">
        <button type="button"
                id="page-prev-btn"
                class="mm-page-btn"
                ${estado.paginaActual <= 1 ? "disabled" : ""}>
          ← Anterior
        </button>
        ${botonesNumeros.join("")}
        <button type="button"
                id="page-next-btn"
                class="mm-page-btn"
                ${estado.paginaActual >= totalPaginas ? "disabled" : ""}>
          Siguiente →
        </button>
      </div>
    `;

    const btnPrev = document.getElementById("page-prev-btn");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (estado.paginaActual > 1) {
          estado.paginaActual -= 1;
          renderizarResultadosCatalogo();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    }

    const btnNext = document.getElementById("page-next-btn");
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if (estado.paginaActual < totalPaginas) {
          estado.paginaActual += 1;
          renderizarResultadosCatalogo();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    }

    contenedor.querySelectorAll("[data-page-num]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nueva = Number(btn.getAttribute("data-page-num"));
        if (nueva && nueva !== estado.paginaActual) {
          estado.paginaActual = nueva;
          renderizarResultadosCatalogo();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });
  }

  function actualizarVistasIndex() {
    const vInicio = document.getElementById("vista-inicio");
    const vCatalogo = document.getElementById("vista-catalogo");
    if (!vInicio || !vCatalogo) return;

    renderizarBarraCategorias();
    if (estado.vistaActual === "catalogo") {
      vInicio.classList.add("hidden");
      vCatalogo.classList.remove("hidden");
      renderizarSidebarFiltros();
      renderizarResultadosCatalogo();
    } else {
      vCatalogo.classList.add("hidden");
      vInicio.classList.remove("hidden");
      renderizarInicio();
    }
  }

  // ─── [BLOQUE 09] Modal de detalle de producto con disponibilidad ───────────

  async function abrirModalDetalleProducto(idProducto) {
    const prod = estado.productos.find((p) => p.id_producto === Number(idProducto));
    const modal = document.getElementById("product-detail-modal");
    const body = document.getElementById("product-detail-body");
    if (!prod || !modal || !body) return;

    body.innerHTML = `
      <div class="grid gap-6 md:grid-cols-2">
        <div class="flex h-72 items-center justify-center overflow-hidden rounded-xl border border-[#e8e2dc] bg-[#faf8f5]">
          ${
            prod.imagen_url
              ? `<img src="${escapar(prod.imagen_url)}" alt="${escapar(
                  prod.nombre
                )}" class="h-full w-full object-cover" onerror="this.style.display='none'">`
              : `<div class="img-placeholder-box h-44 w-44">Sin imagen</div>`
          }
        </div>
        <div class="flex flex-col justify-between">
          <div>
            <div class="flex flex-wrap items-center justify-between gap-2 pr-8">
              <span class="mm-eyebrow rounded-md border border-[#ffd8b5] bg-[#fff3e6] px-2.5 py-1">
                ${escapar(prod.categoria_nombre)}
              </span>
              ${
                prod.codigo_barras
                  ? `<span class="font-mono text-[11px] text-[#68706c]">EAN: ${escapar(
                      prod.codigo_barras
                    )}</span>`
                  : ""
              }
            </div>
            <h3 class="mt-2.5 text-xl font-extrabold leading-snug text-[#1f2421]">${escapar(
              prod.nombre
            )}</h3>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="text-2xl font-extrabold text-[#f67300]">$${prod.precio_base.toFixed(
                2
              )}</span>
              <span class="text-xs text-[#68706c]">IVA incluido</span>
            </div>

            <div class="mt-4 border-t border-[#e8e2dc] pt-3">
              <h4 class="mm-eyebrow mb-1">Descripción del producto</h4>
              <p class="text-sm leading-relaxed text-[#1f2421]">${escapar(
                prod.descripcion
              )}</p>
            </div>

            <div class="mt-4 border-t border-[#e8e2dc] pt-3">
              <h4 class="mm-eyebrow mb-2">Disponibilidad por sucursal</h4>
              <div id="detail-stock-list" class="max-h-36 space-y-1.5 overflow-y-auto pr-1 text-xs text-[#68706c]">
                Consultando disponibilidad en sucursales...
              </div>
            </div>
          </div>

          <div class="mt-5 flex items-center gap-3 border-t border-[#e8e2dc] pt-4">
            <div class="flex items-center rounded-lg border border-[#dfd8d0] bg-[#faf8f5] px-3 py-2">
              <button type="button" id="detail-minus" class="px-1.5 font-bold text-[#68706c] hover:text-[#1f2421]">−</button>
              <input id="detail-qty" type="number" value="1" min="1" max="999" class="w-12 bg-transparent text-center text-sm font-bold text-[#1f2421] focus:outline-none">
              <button type="button" id="detail-plus" class="px-1.5 font-bold text-[#68706c] hover:text-[#1f2421]">+</button>
            </div>
            <button type="button"
                    id="detail-add-btn"
                    class="mm-btn-primary flex-1 px-4 py-2.5 text-sm">
              Agregar a mi carrito
            </button>
          </div>
        </div>
      </div>
    `;

    modal.classList.add("open");

    const inputQty = document.getElementById("detail-qty");
    document.getElementById("detail-minus").addEventListener("click", () => {
      inputQty.value = Math.max(1, (parseInt(inputQty.value, 10) || 1) - 1);
    });
    document.getElementById("detail-plus").addEventListener("click", () => {
      inputQty.value = Math.min(999, (parseInt(inputQty.value, 10) || 1) + 1);
    });
    document.getElementById("detail-add-btn").addEventListener("click", () => {
      agregarAlCarrito(prod.id_producto, parseInt(inputQty.value, 10) || 1);
      cerrarModalDetalleProducto();
    });

    const stockBox = document.getElementById("detail-stock-list");
    let listaDisp = prod.disponibilidad;
    if (!listaDisp) {
      try {
        listaDisp = await peticionApi(
          `/productos/${prod.id_producto}/disponibilidad`,
          null,
          6000
        );
        if (Array.isArray(listaDisp)) {
          prod.disponibilidad = listaDisp;
        }
      } catch (_) {}
    }

    if (stockBox) {
      if (Array.isArray(listaDisp) && listaDisp.length > 0) {
        stockBox.innerHTML = listaDisp
          .map((d) => {
            const cant = Number(d.stock_disponible) || 0;
            return `
              <div class="flex items-center justify-between rounded-lg border border-[#e8e2dc] bg-[#faf8f5] px-3 py-1.5">
                <span class="font-semibold text-[#1f2421]">${escapar(
                  d.nombre_sucursal
                )}</span>
                <span class="mm-stock ${cant <= 15 ? "low" : ""}">${cant} disp.</span>
              </div>
            `;
          })
          .join("");
      } else {
        stockBox.innerHTML = estado.sucursales
          .map(
            (s) => `
              <div class="flex items-center justify-between rounded-lg border border-[#e8e2dc] bg-[#faf8f5] px-3 py-1.5">
                <span class="font-semibold text-[#1f2421]">${escapar(s.nombre)}</span>
                <span class="mm-stock">En catálogo</span>
              </div>
            `
          )
          .join("");
      }
    }
  }

  function cerrarModalDetalleProducto() {
    const modal = document.getElementById("product-detail-modal");
    if (modal) modal.classList.remove("open");
  }

  // ─── Direcciones del cliente (/direcciones) ─────────────────────────────────

  async function cargarDireccionesCliente() {
    if (!estado.sesion || !estado.sesion.token) {
      return;
    }
    try {
      const dirs = await peticionApi(
        "/direcciones",
        {
          headers: { Authorization: `Bearer ${estado.sesion.token}` },
        },
        8000
      );
      if (Array.isArray(dirs)) {
        estado.direccionesCliente = dirs;
        estado.direccionesCargadas = true;
        if (!estado.idDireccionSeleccionada && dirs.length > 0) {
          estado.idDireccionSeleccionada = dirs[0].id_direccion;
        }
      }
    } catch (_) {}
  }

  // ─── [BLOQUE 10] Drawer de checkout y vinculación de ubicación del cliente ─

  async function abrirCarrito() {
    const overlay = document.getElementById("cart-overlay");
    const drawer = document.getElementById("cart-drawer");
    if (overlay && drawer) {
      if (estado.sesion && !estado.direccionesCargadas) {
        await cargarDireccionesCliente();
      }
      renderizarDrawerCarrito();
      overlay.classList.add("open");
      drawer.classList.add("open");
    }
  }

  function cerrarCarrito() {
    const overlay = document.getElementById("cart-overlay");
    const drawer = document.getElementById("cart-drawer");
    if (overlay && drawer) {
      overlay.classList.remove("open");
      drawer.classList.remove("open");
    }
  }

  function renderizarDrawerCarrito() {
    const { unidades, subtotal, costoEnvio, total, lineas } = calcularTotalesCarrito();
    const contadorTxt = document.getElementById("cart-drawer-count");
    const cuerpo = document.getElementById("cart-drawer-body");
    if (!contadorTxt || !cuerpo) return;

    contadorTxt.textContent = `${unidades} producto${unidades === 1 ? "" : "s"}`;

    if (lineas.length === 0) {
      cuerpo.innerHTML = `
        <div class="mt-16 flex flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#ffd8b5] bg-[#fff3e6] text-[#f67300] shadow-sm">
            <svg class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 6h12m-9 0a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z"/>
            </svg>
          </div>
          <p class="text-sm font-semibold text-[#1f2421]">Aún no hay productos en tu carretilla</p>
          <p class="mt-1 text-xs text-[#68706c]">Agrega artículos del catálogo para realizar tu pedido.</p>
        </div>
      `;
      return;
    }

    // Regla de negocio: pedidos de más de $50 solo se pagan con tarjeta (Wompi)
    const exigeTarjeta = total > LIMITE_PAGO_TARJETA;
    if (exigeTarjeta && estado.metodoPago !== "TARJETA") {
      estado.metodoPago = "TARJETA";
    }

    const opcionesSucursales = estado.sucursales
      .map(
        (s) =>
          `<option value="${s.id_sucursal}" ${
            Number(estado.idSucursalActiva) === s.id_sucursal ? "selected" : ""
          }>${escapar(s.nombre)} — ${escapar(s.direccion)}</option>`
      )
      .join("");

    const opcionesMunicipios = estado.municipios
      .map((m) => `<option value="${m.id_municipio}">${escapar(m.nombre)}</option>`)
      .join("");

    const opcionesDirecciones = estado.direccionesCliente
      .map(
        (d) =>
          `<option value="${d.id_direccion}" ${
            Number(estado.idDireccionSeleccionada) === d.id_direccion ? "selected" : ""
          }>${escapar(d.detalle_direccion)}</option>`
      )
      .join("");

    cuerpo.innerHTML = `
      <div class="divide-y divide-[#e8e2dc] px-4">
        ${lineas
          .map(
            (item) => `
            <div class="flex items-center gap-3 py-3">
              <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#e8e2dc] bg-white">
                ${
                  item.imagen_url
                    ? `<img src="${escapar(
                        item.imagen_url
                      )}" alt="" class="h-full w-full object-cover" onerror="this.style.display='none'">`
                    : `<div class="h-10 w-10 rounded bg-[#faf8f5]"></div>`
                }
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs font-bold text-[#1f2421]">${escapar(item.nombre)}</p>
                <p class="mt-0.5 text-xs font-extrabold text-[#d95b00]">$${item.subtotal.toFixed(
                  2
                )} <span class="font-normal text-[#68706c]">($${item.precio_base.toFixed(
              2
            )} c/u)</span></p>
                <div class="mt-1.5 flex items-center gap-2">
                  <div class="inline-flex items-center rounded-md border border-[#dfd8d0] bg-white px-2 py-0.5 text-xs">
                    <button type="button" data-cart-dec="${
                      item.id_producto
                    }" class="px-1 font-bold text-[#68706c] hover:text-[#1f2421]">−</button>
                    <span class="px-2 font-bold text-[#1f2421]">${item.cantidad}</span>
                    <button type="button" data-cart-inc="${
                      item.id_producto
                    }" class="px-1 font-bold text-[#68706c] hover:text-[#1f2421]">+</button>
                  </div>
                  <button type="button" data-cart-del="${
                    item.id_producto
                  }" class="text-[11px] font-semibold text-[#b93838] hover:underline">Quitar</button>
                </div>
              </div>
            </div>
          `
          )
          .join("")}
      </div>

      <!-- Configuración de entrega y método de pago -->
      <div class="mx-4 mt-4 space-y-3 rounded-xl border border-[#e8e2dc] bg-white p-3.5 shadow-sm">
        <div>
          <span class="mm-eyebrow block mb-1.5">Modalidad de entrega</span>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <button type="button"
                    data-entrega-btn="RETIRO"
                    class="flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 font-semibold transition ${
                      estado.tipoEntrega === "RETIRO"
                        ? "border-[#f67300] bg-[#fff3e6] text-[#d95b00]"
                        : "border-[#e8e2dc] bg-white text-[#68706c] hover:bg-[#faf8f5]"
                    }">
              <span class="material-symbols-outlined text-[17px]">storefront</span>
              <span>Retiro ($0.00)</span>
            </button>
            <button type="button"
                    data-entrega-btn="DOMICILIO"
                    class="flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 font-semibold transition ${
                      estado.tipoEntrega === "DOMICILIO"
                        ? "border-[#f67300] bg-[#fff3e6] text-[#d95b00]"
                        : "border-[#e8e2dc] bg-white text-[#68706c] hover:bg-[#faf8f5]"
                    }">
              <span class="material-symbols-outlined text-[17px]">two_wheeler</span>
              <span>Domicilio (+$1.50)</span>
            </button>
          </div>
        </div>

        ${
          estado.tipoEntrega === "RETIRO"
            ? `
              <div>
                <label class="mb-1 block text-[11px] font-semibold text-[#68706c]">Sucursal de retiro</label>
                <select id="cart-sucursal-select" class="mm-input w-full px-2.5 py-1.5 text-xs">
                  ${opcionesSucursales}
                </select>
              </div>
            `
            : `
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-[11px] font-semibold text-[#68706c]">Dirección de entrega</label>
                  <button type="button" id="btn-toggle-nueva-dir" class="text-[11px] font-bold text-[#d95b00] underline">
                    ${estado.mostrarFormNuevaDireccion ? "Cancelar" : "+ Nueva dirección"}
                  </button>
                </div>
                ${
                  !estado.sesion
                    ? `<p class="rounded-lg bg-[#fff2d9] px-2.5 py-1.5 text-[11px] font-medium text-[#9b6500]">Inicia sesión para cargar o registrar tu dirección de entrega.</p>`
                    : estado.direccionesCliente.length > 0 && !estado.mostrarFormNuevaDireccion
                    ? `<select id="cart-direccion-select" class="mm-input w-full px-2.5 py-1.5 text-xs">${opcionesDirecciones}</select>`
                    : ""
                }
                ${
                  estado.sesion &&
                  (estado.mostrarFormNuevaDireccion || estado.direccionesCliente.length === 0)
                    ? `
                       <div class="space-y-2 rounded-lg border border-[#e8e2dc] bg-[#faf8f5] p-3">
                        <button type="button"
                                id="btn-detectar-gps-cliente"
                                class="w-full flex items-center justify-center gap-1.5 rounded-md border border-[#e8e2dc] bg-white px-3 py-2 text-xs font-semibold text-[#1f2421] hover:border-[#f67300] hover:text-[#d95b00] transition">
                          <span class="material-symbols-outlined text-[17px] text-[#f67300]">my_location</span>
                          <span id="btn-detectar-gps-label">
                            ${
                              estado.detectandoGpsDireccion
                                ? "Obteniendo ubicación..."
                                : estado.coordenadasNuevaDireccion
                                ? "Ubicación vinculada (volver a detectar)"
                                : "Usar ubicación del dispositivo"
                            }
                          </span>
                        </button>

                        <div id="gps-status-box" class="${
                          estado.coordenadasNuevaDireccion ? "" : "hidden"
                        } flex items-center gap-1.5 rounded-md bg-[#f0fdf4] border border-[#bbf7d0] px-2.5 py-1 text-[11px] text-[#166534]">
                          <span class="material-symbols-outlined text-[16px] text-[#16a34a]">check_circle</span>
                          <span class="font-semibold">Ubicación vinculada</span>
                        </div>

                        <div>
                          <label class="mb-1 block text-[11px] font-semibold text-[#68706c]">Municipio</label>
                          <select id="new-dir-muni" class="mm-input w-full px-2.5 py-1.5 text-xs font-medium">${opcionesMunicipios}</select>
                        </div>

                        <div>
                          <label class="mb-1 block text-[11px] font-semibold text-[#68706c]">Colonia, calle y número de casa</label>
                          <input id="new-dir-detalle"
                                 type="text"
                                 maxlength="300"
                                 placeholder="Ej. Colonia Ciudad Jardín, Calle Los Pinos #4"
                                 class="mm-input w-full px-2.5 py-1.5 text-xs">
                        </div>

                        <div>
                          <label class="mb-1 block text-[11px] font-semibold text-[#68706c]">Punto de referencia (opcional)</label>
                          <input id="new-dir-ref"
                                 type="text"
                                 maxlength="300"
                                 placeholder="Ej. Frente a parque infantil"
                                 class="mm-input w-full px-2.5 py-1.5 text-xs">
                        </div>

                        <button type="button" id="btn-save-dir" class="mm-btn-primary w-full py-2 text-xs font-bold">
                          Guardar dirección
                        </button>
                      </div>
                    `
                    : ""
                }
              </div>
            `
        }

        <div>
          <label class="mb-1 block text-[11px] font-semibold text-[#68706c]">Método de pago</label>
          <select id="cart-metodo-pago" class="mm-input w-full px-2.5 py-1.5 text-xs">
            <option value="CONTRA_ENTREGA" ${
              estado.metodoPago === "CONTRA_ENTREGA" ? "selected" : ""
            } ${exigeTarjeta ? "disabled" : ""}>Efectivo contra entrega</option>
            <option value="TRANSFERENCIA" ${
              estado.metodoPago === "TRANSFERENCIA" ? "selected" : ""
            } ${exigeTarjeta ? "disabled" : ""}>Transferencia bancaria</option>
            <option value="TARJETA" ${
              estado.metodoPago === "TARJETA" ? "selected" : ""
            }>Tarjeta de crédito / débito (Wompi)</option>
          </select>
          ${
            exigeTarjeta
              ? `<p class="mt-1.5 rounded-lg bg-[#fff3e6] px-2.5 py-1.5 text-[11px] font-medium text-[#d95b00]">Los pedidos de más de $${LIMITE_PAGO_TARJETA.toFixed(
                  2
                )} se pagan con tarjeta.</p>`
              : estado.metodoPago === "TARJETA"
              ? `<p class="mt-1.5 text-[11px] text-[#68706c]">Ingresarás los datos de tu tarjeta en el siguiente paso.</p>`
              : ""
          }
        </div>

        <div class="space-y-1 border-t border-[#e8e2dc] pt-2.5 text-xs">
          <div class="flex justify-between text-[#68706c]">
            <span>Subtotal</span>
            <span>$${subtotal.toFixed(2)}</span>
          </div>
          <div class="flex justify-between text-[#68706c]">
            <span>Costo de envío</span>
            <span>$${costoEnvio.toFixed(2)}</span>
          </div>
          <div class="flex justify-between pt-1 text-sm font-extrabold text-[#1f2421]">
            <span>Total estimado</span>
            <span class="text-[#f67300]">$${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    `;

    cuerpo.querySelectorAll("[data-cart-dec]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-cart-dec");
        const act = estado.carrito[id]
          ? Number(estado.carrito[id].cantidad || estado.carrito[id])
          : 1;
        cambiarCantidadCarrito(id, act - 1);
      });
    });
    cuerpo.querySelectorAll("[data-cart-inc]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-cart-inc");
        const act = estado.carrito[id]
          ? Number(estado.carrito[id].cantidad || estado.carrito[id])
          : 0;
        cambiarCantidadCarrito(id, act + 1);
      });
    });
    cuerpo.querySelectorAll("[data-cart-del]").forEach((b) => {
      b.addEventListener("click", () =>
        cambiarCantidadCarrito(b.getAttribute("data-cart-del"), 0)
      );
    });

    cuerpo.querySelectorAll("[data-entrega-btn]").forEach((b) => {
      b.addEventListener("click", async () => {
        estado.tipoEntrega = b.getAttribute("data-entrega-btn");
        if (estado.tipoEntrega === "DOMICILIO" && estado.sesion && !estado.direccionesCargadas) {
          await cargarDireccionesCliente();
        }
        renderizarDrawerCarrito();
        if (
          estado.tipoEntrega === "DOMICILIO" &&
          estado.sesion &&
          estado.direccionesCliente.length === 0
        ) {
          activarDeteccionGpsCliente(false);
        }
      });
    });

    const selSuc = document.getElementById("cart-sucursal-select");
    if (selSuc) {
      selSuc.addEventListener("change", () => {
        estado.idSucursalActiva = Number(selSuc.value);
        guardarStorage(STORAGE_SUCURSAL, estado.idSucursalActiva);
        renderizarSucursalHeader();
      });
    }

    const selDir = document.getElementById("cart-direccion-select");
    if (selDir) {
      selDir.addEventListener("change", () => {
        estado.idDireccionSeleccionada = Number(selDir.value);
      });
    }

    const btnToggleDir = document.getElementById("btn-toggle-nueva-dir");
    if (btnToggleDir) {
      btnToggleDir.addEventListener("click", () => {
        estado.mostrarFormNuevaDireccion = !estado.mostrarFormNuevaDireccion;
        if (!estado.mostrarFormNuevaDireccion) {
          estado.coordenadasNuevaDireccion = null;
        }
        renderizarDrawerCarrito();
        if (estado.mostrarFormNuevaDireccion) {
          activarDeteccionGpsCliente(false);
        }
      });
    }

    const btnGps = document.getElementById("btn-detectar-gps-cliente");
    if (btnGps) {
      btnGps.addEventListener("click", () => {
        activarDeteccionGpsCliente(true);
      });
    }

    const btnSaveDir = document.getElementById("btn-save-dir");
    if (btnSaveDir) {
      btnSaveDir.addEventListener("click", guardarNuevaDireccionEnDrawer);
    }

    const selPago = document.getElementById("cart-metodo-pago");
    if (selPago) {
      selPago.addEventListener("change", () => {
        estado.metodoPago = selPago.value;
        renderizarDrawerCarrito();
      });
    }
    actualizarTextoBotonCheckout();
  }

  function actualizarTextoBotonCheckout() {
    const btn = document.getElementById("cart-checkout-btn");
    if (!btn || btn.disabled) return;
    btn.textContent =
      estado.metodoPago === "TARJETA" ? "Continuar al pago con tarjeta" : "Confirmar pedido";
  }

  // ─── Detección automática de ubicación y geocodificación del dispositivo ────

  function obtenerCoordenadasDispositivo() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Tu dispositivo o navegador no admite geolocalización."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            precision: pos.coords.accuracy,
            origen: "gps",
          });
        },
        async (err) => {
          // Si el usuario deniega temporalmente o no hay antena GPS, intentar aproximación por IP
          try {
            const resp = await fetch(
              "https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=es"
            );
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.latitude != null && data.longitude != null) {
                resolve({
                  latitud: data.latitude,
                  longitud: data.longitude,
                  precision: 1000,
                  origen: "ip",
                  ciudad: data.city || data.locality || data.principalSubdivision || "",
                });
                return;
              }
            }
          } catch (_) {}

          let mensaje = "No se pudo obtener la ubicación de tu dispositivo.";
          if (err.code === 1) {
            mensaje =
              "Permiso de ubicación denegado en tu navegador. Puedes activarlo o ingresar tu dirección manualmente.";
          } else if (err.code === 2) {
            mensaje = "Señal GPS no disponible en este momento en tu dispositivo.";
          } else if (err.code === 3) {
            mensaje = "Se agotó el tiempo buscando la señal GPS de tu dispositivo.";
          }
          reject(new Error(mensaje));
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );
    });
  }

  async function resolverDireccionDesdeCoordenadas(lat, lng) {
    let detalle = "";
    let nombreMunicipio = "";

    // 1. Consultar BigDataCloud (CORS abierto para navegadores clientes)
    try {
      const resBdc = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=es`,
        { headers: { Accept: "application/json" } }
      );
      if (resBdc.ok) {
        const bdc = await resBdc.json();
        nombreMunicipio = bdc.city || bdc.locality || bdc.principalSubdivision || "";
        const partes = [];
        if (bdc.locality && bdc.locality !== nombreMunicipio) partes.push(bdc.locality);
        if (nombreMunicipio) partes.push(nombreMunicipio);
        if (partes.length > 0) detalle = partes.join(", ");
      }
    } catch (_) {}

    // 2. Consultar Nominatim OSM para enriquecer con calle, pasaje, colonia y número
    try {
      const resOsm = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=es`,
        { headers: { Accept: "application/json" } }
      );
      if (resOsm.ok) {
        const osm = await resOsm.json();
        const addr = osm.address || {};
        const partes = [];
        const via = addr.road || addr.street || addr.pedestrian || addr.highway || "";
        const num = addr.house_number || "";
        if (via) partes.push(num ? `${via} #${num}` : via);
        const col = addr.neighbourhood || addr.suburb || addr.residential || addr.quarter || "";
        if (col) partes.push(`Col. ${col}`);
        const muniOsm = addr.city || addr.town || addr.municipality || addr.village || "";
        if (muniOsm) {
          if (!nombreMunicipio) nombreMunicipio = muniOsm;
          if (!partes.join(" ").toLowerCase().includes(muniOsm.toLowerCase())) {
            partes.push(muniOsm);
          }
        }
        if (partes.length > 0) {
          detalle = partes.join(", ");
        } else if (osm.display_name && !detalle) {
          detalle = osm.display_name.split(",").slice(0, 3).join(", ").trim();
        }
      }
    } catch (_) {}

    if (!detalle) {
      detalle = `Ubicación GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    }

    return {
      detalle: detalle,
      municipio: nombreMunicipio,
      latitud: lat,
      longitud: lng,
    };
  }

  function seleccionarMunicipioMasCercano(nombreBuscado, lat, lng) {
    if (!Array.isArray(estado.municipios) || estado.municipios.length === 0) return 1;

    // 1. Coincidencia por texto
    if (nombreBuscado) {
      const normB = nombreBuscado
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      for (const m of estado.municipios) {
        const normM = m.nombre
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        if (normB.includes(normM) || normM.includes(normB)) {
          return m.id_municipio;
        }
      }
    }

    // 2. Coincidencia por proximidad geográfica con coordenadas de referencia
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const COORD_REF = {
        "san miguel": { lat: 13.4834, lng: -88.1833 },
        "chinameca": { lat: 13.5011, lng: -88.3514 },
        "moncagua": { lat: 13.5358, lng: -88.2503 },
        "quelepa": { lat: 13.5167, lng: -88.2333 },
        "el transito": { lat: 13.3553, lng: -88.3564 },
      };
      let mejorId = null;
      let menorDist = Infinity;
      for (const m of estado.municipios) {
        const normM = m.nombre
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const ref = COORD_REF[normM];
        if (ref) {
          const d = Math.hypot(lat - ref.lat, lng - ref.lng);
          if (d < menorDist) {
            menorDist = d;
            mejorId = m.id_municipio;
          }
        }
      }
      if (mejorId) return mejorId;
    }

    // 3. Predeterminado: San Miguel o el primer municipio de la lista
    const sm = estado.municipios.find((m) =>
      m.nombre.toLowerCase().includes("san miguel")
    );
    return sm ? sm.id_municipio : estado.municipios[0].id_municipio;
  }

  async function activarDeteccionGpsCliente(notificarError = true) {
    const btnLabel = document.getElementById("btn-detectar-gps-label");
    const btnGps = document.getElementById("btn-detectar-gps-cliente");
    const statusBox = document.getElementById("gps-status-box");

    if (btnLabel) btnLabel.textContent = "Obteniendo ubicación del dispositivo...";
    if (btnGps) btnGps.disabled = true;
    estado.detectandoGpsDireccion = true;

    try {
      const coords = await obtenerCoordenadasDispositivo();
      const res = await resolverDireccionDesdeCoordenadas(coords.latitud, coords.longitud);

      estado.coordenadasNuevaDireccion = {
        latitud: coords.latitud,
        longitud: coords.longitud,
      };

      const selMuni = document.getElementById("new-dir-muni");
      const inDetalle = document.getElementById("new-dir-detalle");
      const inRef = document.getElementById("new-dir-ref");

      if (selMuni) {
        selMuni.value = seleccionarMunicipioMasCercano(
          res.municipio,
          coords.latitud,
          coords.longitud
        );
      }
      if (inDetalle) {
        inDetalle.value = res.detalle;
        inDetalle.classList.add("!border-[#f67300]", "!bg-[#fffdf9]");
        setTimeout(
          () => inDetalle.classList.remove("!border-[#f67300]", "!bg-[#fffdf9]"),
          1500
        );
      }
      if (inRef && !inRef.value) {
        inRef.value =
          coords.origen === "ip"
            ? "Ubicación aproximada detectada"
            : "Ubicación detectada por GPS de este dispositivo";
      }

      if (statusBox) {
        statusBox.classList.remove("hidden");
      }

      mostrarToast("¡Ubicación vinculada correctamente!");
    } catch (err) {
      if (notificarError) {
        mostrarToast(err.message || "No se pudo obtener la ubicación del dispositivo.");
      }
    } finally {
      estado.detectandoGpsDireccion = false;
      if (btnGps) btnGps.disabled = false;
      if (btnLabel) {
        btnLabel.textContent = estado.coordenadasNuevaDireccion
          ? "Ubicación vinculada (volver a detectar)"
          : "Usar ubicación del dispositivo";
      }
    }
  }

  async function guardarNuevaDireccionEnDrawer() {
    const idMuni = Number(document.getElementById("new-dir-muni").value) || 1;
    const detalle = limpiarTexto(document.getElementById("new-dir-detalle").value, 300);
    const referencia = limpiarTexto(document.getElementById("new-dir-ref").value, 300) || null;

    if (detalle.length < 3) {
      mostrarToast("Escribe el detalle de tu dirección (mínimo 3 caracteres).");
      return;
    }

    const payload = {
      id_municipio: idMuni,
      detalle_direccion: detalle,
      punto_referencia: referencia,
    };
    if (estado.coordenadasNuevaDireccion && estado.coordenadasNuevaDireccion.latitud != null) {
      payload.latitud = Number(Number(estado.coordenadasNuevaDireccion.latitud).toFixed(6));
      payload.longitud = Number(Number(estado.coordenadasNuevaDireccion.longitud).toFixed(6));
    }

    try {
      const creada = await peticionApi(
        "/direcciones",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${estado.sesion.token}`,
          },
          body: JSON.stringify(payload),
        },
        10000
      );
      estado.direccionesCliente.push(creada);
      estado.idDireccionSeleccionada = creada.id_direccion;
      estado.mostrarFormNuevaDireccion = false;
      estado.coordenadasNuevaDireccion = null;
      mostrarToast("Dirección guardada correctamente.");
      renderizarDrawerCarrito();
    } catch (err) {
      if (err && err.status === 401) {
        estado.sesion = null;
        localStorage.removeItem(STORAGE_AUTH);
        renderizarSesionHeader();
        mostrarToast("Tu sesión expiró. Inicia sesión nuevamente.");
        setTimeout(() => {
          window.location.href = "login.html";
        }, 700);
        return;
      }
      mostrarToast(
        err.message ||
          "Problemas de conexión al guardar la dirección. Inténtalo nuevamente."
      );
    }
  }

  async function procesarPagoCarrito() {
    // Asegurar que los IDs del carrito estén sincronizados con el servidor antes de enviar
    if (estado.modoFuente !== "online") {
      await inicializarDatosAPI();
    } else {
      sincronizarCarritoConCatalogoActivo();
    }

    const { lineas, total } = calcularTotalesCarrito();
    if (lineas.length === 0) {
      mostrarToast("Agrega al menos un producto a tu carretilla.");
      return;
    }
    if (!estado.sesion || !estado.sesion.token) {
      mostrarToast("Inicia sesión para confirmar tu pedido.");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 650);
      return;
    }

    // Si es a domicilio y el usuario escribió una dirección en el formulario sin haber pulsado "Guardar dirección", guardarla primero
    if (estado.tipoEntrega === "DOMICILIO" && !estado.idDireccionSeleccionada) {
      const inputDetalle = document.getElementById("new-dir-detalle");
      if (inputDetalle && inputDetalle.value.trim().length >= 3) {
        await guardarNuevaDireccionEnDrawer();
      }
      if (!estado.idDireccionSeleccionada) {
        mostrarToast("Selecciona o guarda una dirección de entrega.");
        return;
      }
    }

    const btnCheckout = document.getElementById("cart-checkout-btn");
    if (btnCheckout) {
      btnCheckout.disabled = true;
      btnCheckout.textContent = "Procesando pedido...";
    }

    const payload = {
      items: lineas.map((l) => ({
        id_producto: Number(l.id_producto),
        cantidad: Number(l.cantidad),
      })),
      tipo_entrega: estado.tipoEntrega,
      metodo_pago: estado.metodoPago,
      canal: "WEB",
    };

    // Pedidos de más de $50 solo se pagan con tarjeta (también se valida aquí por seguridad)
    if (total > LIMITE_PAGO_TARJETA) {
      payload.metodo_pago = "TARJETA";
    }

    if (estado.tipoEntrega === "DOMICILIO") {
      payload.id_direccion = Number(estado.idDireccionSeleccionada);
      payload.id_sucursal = null;
    } else {
      payload.id_sucursal =
        Number(estado.idSucursalActiva) ||
        (estado.sucursales[0] && estado.sucursales[0].id_sucursal) ||
        1;
      payload.id_direccion = null;
    }

    try {
      const pedido = await peticionApiUnica(
        "/pedidos",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${estado.sesion.token}`,
          },
          body: JSON.stringify(payload),
        },
        25000
      );
      estado.carrito = {};
      guardarCarrito();
      cerrarCarrito();
      const codigo = pedido.codigo_pedido || `#${pedido.id_pedido}`;
      const montoPedido = Number(pedido.total || total);

      if (payload.metodo_pago === "TARJETA") {
        // El pedido ya existe (pago pendiente): solicitar los datos de la tarjeta
        mostrarToast(`Pedido ${codigo} creado. Completa el pago con tarjeta.`);
        abrirModalPagoTarjeta({
          id_pedido: pedido.id_pedido,
          codigo_pedido: codigo,
          total: montoPedido,
        });
        return;
      }

      mostrarToast(`¡Pedido ${codigo} confirmado por $${montoPedido.toFixed(2)}!`);
      abrirModalMisPedidos();
    } catch (err) {
      if (err && err.status === 401) {
        estado.sesion = null;
        localStorage.removeItem(STORAGE_AUTH);
        renderizarSesionHeader();
        mostrarToast("Tu sesión expiró. Por favor inicia sesión de nuevo.");
        setTimeout(() => {
          window.location.href = "login.html";
        }, 700);
        return;
      }
      mostrarToast(
        err.message ||
          "Problemas de conexión al procesar tu pedido. Inténtalo nuevamente."
      );
    } finally {
      if (btnCheckout) {
        btnCheckout.disabled = false;
        actualizarTextoBotonCheckout();
      }
    }
  }

  // ─── [BLOQUE 11] Procesamiento de pedidos y pasarela de pago con tarjeta ───

  let pagoTarjetaPedido = null;
  let pagoTarjetaProcesando = false;

  function etiquetaMetodoPago(metodo) {
    const m = String(metodo || "").toUpperCase();
    if (m === "TARJETA") return "Tarjeta (Wompi)";
    if (m === "CONTRA_ENTREGA") return "Contra entrega";
    if (m === "TRANSFERENCIA") return "Transferencia";
    return metodo || "";
  }

  function detectarMarcaTarjeta(digitos) {
    if (/^4/.test(digitos)) return "VISA";
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digitos)) return "MASTERCARD";
    if (/^3[47]/.test(digitos)) return "AMEX";
    return "TARJETA";
  }

  function formatearNumeroTarjeta(valor) {
    const d = String(valor || "").replace(/\D/g, "").slice(0, 19);
    return d.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatearVencimiento(valor) {
    const d = String(valor || "").replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  }

  function asegurarModalPagoTarjeta() {
    if (document.getElementById("card-pay-modal")) return;
    const div = document.createElement("div");
    div.id = "card-pay-modal";
    div.className =
      "overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4";
    div.innerHTML = `
      <div class="mm-panel relative max-h-[94vh] w-full max-w-md overflow-y-auto border-t-4 border-t-[#f67300] p-6 shadow-2xl">
        <button type="button" id="card-pay-close" aria-label="Cerrar" class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#faf8f5] text-[#68706c] hover:text-[#1f2421]">✕</button>
        <div id="card-pay-body"></div>
      </div>
    `;
    document.body.appendChild(div);
    document
      .getElementById("card-pay-close")
      .addEventListener("click", () => cerrarModalPagoTarjeta(true));
  }

  function cerrarModalPagoTarjeta(avisar) {
    if (pagoTarjetaProcesando) return;
    const modal = document.getElementById("card-pay-modal");
    if (modal) modal.classList.remove("open");
    if (avisar && pagoTarjetaPedido) {
      mostrarToast(
        "Tu pedido quedó pendiente de pago. Puedes pagarlo desde «Mis pedidos»."
      );
    }
    pagoTarjetaPedido = null;
  }

  function abrirModalPagoTarjeta(pedido) {
    if (!estado.sesion || !estado.sesion.token) {
      mostrarToast("Inicia sesión para pagar tu pedido.");
      return;
    }
    asegurarModalPagoTarjeta();
    pagoTarjetaPedido = pedido;
    pagoTarjetaProcesando = false;
    const total = Number(pedido.total) || 0;
    const body = document.getElementById("card-pay-body");

    body.innerHTML = `
      <p class="mm-eyebrow mb-1">PAGO CON TARJETA</p>
      <h3 class="text-lg font-extrabold text-[#1f2421]">Pagar pedido ${escapar(
        pedido.codigo_pedido
      )}</h3>
      <p class="mt-0.5 text-xs text-[#68706c]">Total a pagar: <strong class="text-[#f67300]">$${total.toFixed(
        2
      )}</strong></p>

      <div class="mm-card-preview mt-4">
        <div class="flex items-center justify-between">
          <span class="mm-card-chip" aria-hidden="true"></span>
          <span id="card-brand" class="text-xs font-extrabold tracking-wider uppercase opacity-90">TARJETA</span>
        </div>
        <p id="card-preview-num" class="mt-4 font-mono text-base sm:text-lg tracking-widest">•••• •••• •••• ••••</p>
        <div class="mt-4 flex items-end justify-between gap-3 text-[11px] opacity-90">
          <span id="card-preview-name" class="truncate uppercase font-medium">NOMBRE DEL TITULAR</span>
          <span id="card-preview-exp" class="font-mono">MM/AA</span>
        </div>
      </div>

      <div id="card-pay-alert" class="hidden"></div>

      <form id="card-pay-form" class="mt-4 space-y-3" autocomplete="off" novalidate>
        <div>
          <label for="card-num" class="mb-1 block text-[11px] font-semibold text-[#68706c]">Número de tarjeta</label>
          <input id="card-num" type="text" inputmode="numeric" autocomplete="off" maxlength="23" placeholder="0000 0000 0000 0000" class="mm-input w-full px-3 py-2 text-sm">
        </div>
        <div>
          <label for="card-name" class="mb-1 block text-[11px] font-semibold text-[#68706c]">Nombre del titular</label>
          <input id="card-name" type="text" autocomplete="off" maxlength="60" placeholder="Como aparece en la tarjeta" class="mm-input w-full px-3 py-2 text-sm">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="card-exp" class="mb-1 block text-[11px] font-semibold text-[#68706c]">Vencimiento</label>
            <input id="card-exp" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="MM/AA" class="mm-input w-full px-3 py-2 text-sm">
          </div>
          <div>
            <label for="card-cvv" class="mb-1 block text-[11px] font-semibold text-[#68706c]">CVV</label>
            <input id="card-cvv" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="•••" class="mm-input w-full px-3 py-2 text-sm">
          </div>
        </div>
        <button type="submit" id="card-pay-submit" class="mm-btn-primary w-full py-2.5 text-sm">Pagar $${total.toFixed(
          2
        )}</button>
      </form>
    `;

    const inNum = document.getElementById("card-num");
    const inName = document.getElementById("card-name");
    const inExp = document.getElementById("card-exp");
    const inCvv = document.getElementById("card-cvv");

    const actualizarVista = () => {
      const digitos = inNum.value.replace(/\D/g, "");
      document.getElementById("card-brand").textContent = detectarMarcaTarjeta(digitos);
      document.getElementById("card-preview-num").textContent =
        inNum.value.trim() || "•••• •••• •••• ••••";
      document.getElementById("card-preview-name").textContent =
        inName.value.trim() || "NOMBRE DEL TITULAR";
      document.getElementById("card-preview-exp").textContent =
        inExp.value.trim() || "MM/AA";
    };

    inNum.addEventListener("input", () => {
      inNum.value = formatearNumeroTarjeta(inNum.value);
      actualizarVista();
    });
    inExp.addEventListener("input", () => {
      inExp.value = formatearVencimiento(inExp.value);
      actualizarVista();
    });
    inName.addEventListener("input", actualizarVista);
    inCvv.addEventListener("input", () => {
      inCvv.value = inCvv.value.replace(/\D/g, "").slice(0, 4);
    });

    document
      .getElementById("card-pay-form")
      .addEventListener("submit", enviarPagoTarjeta);

    document.getElementById("card-pay-modal").classList.add("open");
    setTimeout(() => inNum.focus(), 250);
  }

  function mostrarAlertaTarjeta(texto, esError) {
    const el = document.getElementById("card-pay-alert");
    if (!el) return;
    el.textContent = texto;
    el.className = esError ? "mm-alert error mt-4" : "mm-alert mt-4";
  }

  async function enviarPagoTarjeta(ev) {
    ev.preventDefault();
    if (pagoTarjetaProcesando || !pagoTarjetaPedido) return;

    const pedido = pagoTarjetaPedido;
    const numero = formatearNumeroTarjeta(document.getElementById("card-num").value);
    const digitos = numero.replace(/\D/g, "");
    const titular = limpiarTexto(document.getElementById("card-name").value, 60).toUpperCase();
    const venc = document.getElementById("card-exp").value.trim();
    const cvv = document.getElementById("card-cvv").value.replace(/\D/g, "");

    const mVenc = venc.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    if (digitos.length < 13 || digitos.length > 19) {
      mostrarAlertaTarjeta("Ingresa un número de tarjeta válido.", true);
      return;
    }
    if (titular.length < 3) {
      mostrarAlertaTarjeta("Ingresa el nombre del titular tal como aparece en la tarjeta.", true);
      return;
    }
    if (!mVenc) {
      mostrarAlertaTarjeta("Ingresa la fecha de vencimiento con el formato MM/AA.", true);
      return;
    }
    if (cvv.length < 3 || cvv.length > 4) {
      mostrarAlertaTarjeta("Ingresa el código de seguridad (CVV) de 3 o 4 dígitos.", true);
      return;
    }

    const btn = document.getElementById("card-pay-submit");
    pagoTarjetaProcesando = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Procesando pago...";
    }
    mostrarAlertaTarjeta("Procesando pago con tarjeta...", false);

    try {
      const r = await peticionApiUnica(
        "/pagos/wompi/simular",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${estado.sesion.token}`,
          },
          body: JSON.stringify({
            id_pedido: Number(pedido.id_pedido),
            numero_tarjeta: numero,
            nombre_titular: titular,
            mes_expiracion: mVenc[1],
            anio_expiracion: `20${mVenc[2]}`,
            cvv: cvv,
            email_pagador: (estado.sesion && estado.sesion.email) || undefined,
          }),
        },
        35000
      );

      if (r && r.estado_transaccion === "APROBADA") {
        pagoTarjetaProcesando = false;
        mostrarPagoAprobado(pedido, r);
        return;
      }

      // Rechazo bancario simulado (fondos insuficientes, bloqueo, tarjeta vencida...)
      mostrarAlertaTarjeta(
        (r && r.mensaje) || "La transacción fue declinada. Intenta con otra tarjeta.",
        true
      );
      const cvvEl = document.getElementById("card-cvv");
      if (cvvEl) cvvEl.value = "";
    } catch (err) {
      if (err && err.status === 401) {
        pagoTarjetaProcesando = false;
        estado.sesion = null;
        localStorage.removeItem(STORAGE_AUTH);
        renderizarSesionHeader();
        cerrarModalPagoTarjeta(false);
        mostrarToast("Tu sesión expiró. Inicia sesión y paga desde «Mis pedidos».");
        return;
      }
      mostrarAlertaTarjeta(
        err && err.esErrorRed
          ? "Problemas de conexión con el servidor. Antes de intentarlo de nuevo, revisa «Mis pedidos» para confirmar si el pago se registró."
          : (err && err.message) || "No se pudo procesar el pago. Inténtalo nuevamente.",
        true
      );
    } finally {
      pagoTarjetaProcesando = false;
      const btnFin = document.getElementById("card-pay-submit");
      if (btnFin) {
        btnFin.disabled = false;
        btnFin.textContent = `Pagar $${(Number(pedido.total) || 0).toFixed(2)}`;
      }
    }
  }

  function mostrarPagoAprobado(pedido, r) {
    const body = document.getElementById("card-pay-body");
    if (!body) return;
    const monto = Number(r.monto != null ? r.monto : pedido.total) || 0;
    const filas = [
      ["Pedido", r.codigo_pedido || pedido.codigo_pedido],
      ["Monto", `$${monto.toFixed(2)} ${r.moneda || "USD"}`],
      [
        "Tarjeta",
        r.ultimos_cuatro
          ? `${r.marca_tarjeta || "Tarjeta"} •••• ${r.ultimos_cuatro}`
          : r.marca_tarjeta || "",
      ],
      ["Transacción", r.id_transaccion],
      ["Referencia", r.referencia_wompi],
    ].filter((f) => f[1]);

    body.innerHTML = `
      <div class="text-center">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#dcfce7] text-[#16a34a]">
          <span class="material-symbols-outlined text-3xl">check_circle</span>
        </div>
        <h3 class="text-lg font-extrabold text-[#1f2421]">¡Pago aprobado!</h3>
        <p class="mt-1 text-xs text-[#68706c]">${escapar(
          r.mensaje || "Tu transacción fue procesada con éxito."
        )}</p>
        <div class="mt-4 space-y-1.5 rounded-xl border border-[#e8e2dc] bg-[#faf8f5] p-3 text-left text-xs">
          ${filas
            .map(
              (f) =>
                `<div class="flex justify-between gap-3"><span class="text-[#68706c]">${escapar(
                  f[0]
                )}</span><strong class="break-all text-right text-[#1f2421]">${escapar(
                  f[1]
                )}</strong></div>`
            )
            .join("")}
        </div>
        ${
          r.recibo_enviado_email
            ? `<p class="mt-3 text-[11px] font-semibold text-[#16a34a]">Enviamos tu factura al correo de tu cuenta.</p>`
            : ""
        }
        <button type="button" id="card-pay-done" class="mm-btn-primary mt-4 w-full py-2.5 text-sm">Ver mis pedidos</button>
      </div>
    `;
    pagoTarjetaPedido = null;
    document.getElementById("card-pay-done").addEventListener("click", () => {
      cerrarModalPagoTarjeta(false);
      abrirModalMisPedidos();
    });
    mostrarToast(`¡Pago aprobado! Pedido ${r.codigo_pedido || pedido.codigo_pedido}`);
  }

  // ─── [BLOQUE 12] Telemetría y seguimiento en vivo con Leaflet (Esri ArcGIS) ─

  const seguimiento = {
    idPedido: null,
    cerrado: true,
    mapa: null,
    marcadores: {},
    ws: null,
    intentos: 0,
    timerPing: null,
    timerReconexion: null,
    timerReloj: null,
    anim: null,
    ultimaActualizacion: null,
    tieneRepartidor: false,
  };

  function obtenerWsBase() {
    const base = String(estado.apiBaseActiva || API_URL).replace(/\/+$/, "");
    if (base.startsWith("https://")) return `wss://${base.slice(8)}`;
    if (base.startsWith("http://")) return `ws://${base.slice(7)}`;
    return WS_URL;
  }

  function formatearHace(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 5) return "ahora mismo";
    if (s < 60) return `hace ${s} s`;
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    return `hace ${Math.floor(s / 3600)} h`;
  }

  function asegurarModalSeguimiento() {
    if (document.getElementById("tracking-modal")) return;
    const div = document.createElement("div");
    div.id = "tracking-modal";
    div.className =
      "overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4";
    div.innerHTML = `
      <div class="mm-panel relative max-h-[94vh] w-full max-w-3xl overflow-y-auto border-t-4 border-t-[#f67300] p-5 shadow-2xl">
        <button type="button" id="tracking-close" aria-label="Cerrar" class="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#faf8f5] text-[#68706c] hover:text-[#1f2421]">✕</button>
        <p class="mm-eyebrow mb-1">SEGUIMIENTO EN VIVO</p>
        <h3 id="tracking-title" class="pr-10 text-lg font-extrabold text-[#1f2421]">Tu pedido</h3>
        <div class="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
          <span id="tracking-estado" class="mm-badge pendiente">Cargando...</span>
          <span class="inline-flex items-center gap-1.5 font-semibold text-[#68706c]">
            <span id="tracking-dot" class="mm-live-dot off"></span>
            <span id="tracking-conn">Conectando...</span>
          </span>
        </div>
        <div id="tracking-aviso" class="hidden"></div>
        <div id="tracking-map" class="mm-map mt-3"></div>
        <div id="tracking-info" class="mt-3 grid gap-2 text-xs sm:grid-cols-3"></div>
      </div>
    `;
    document.body.appendChild(div);
    document.getElementById("tracking-close").addEventListener("click", cerrarSeguimiento);
    div.addEventListener("click", (e) => {
      if (e.target === div) cerrarSeguimiento();
    });
  }

  function cerrarSeguimiento() {
    seguimiento.cerrado = true;
    clearInterval(seguimiento.timerPing);
    clearInterval(seguimiento.timerReloj);
    clearTimeout(seguimiento.timerReconexion);
    cancelAnimationFrame(seguimiento.anim);
    seguimiento.timerPing = seguimiento.timerReloj = seguimiento.timerReconexion = null;
    if (seguimiento.ws) {
      try {
        seguimiento.ws.onclose = null;
        seguimiento.ws.close();
      } catch (_) {}
      seguimiento.ws = null;
    }
    if (seguimiento.mapa) {
      seguimiento.mapa.remove();
      seguimiento.mapa = null;
    }
    seguimiento.marcadores = {};
    seguimiento.ultimaActualizacion = null;
    seguimiento.tieneRepartidor = false;
    const modal = document.getElementById("tracking-modal");
    if (modal) modal.classList.remove("open");
  }

  function estadoConexionSeguimiento(enVivo, texto) {
    const dot = document.getElementById("tracking-dot");
    const txt = document.getElementById("tracking-conn");
    if (dot) dot.classList.toggle("off", !enVivo);
    if (txt) txt.textContent = texto;
  }

  function avisoSeguimiento(texto, esError) {
    const el = document.getElementById("tracking-aviso");
    if (!el) return;
    if (!texto) {
      el.className = "hidden";
      el.textContent = "";
      return;
    }
    el.textContent = texto;
    el.className = esError ? "mm-alert error mt-3" : "mm-alert mt-3";
  }

  function iconoSeguimiento(tipo, rumbo) {
    const iconName =
      tipo === "sucursal"
        ? "storefront"
        : tipo === "destino"
        ? "home"
        : "two_wheeler";
    const flecha =
      tipo === "moto"
        ? `<span class="mm-pin-flecha" style="transform:rotate(${Number(rumbo) || 0}deg)"></span>`
        : "";
    return L.divIcon({
      className: "",
      html: `<div class="mm-pin ${tipo}">${flecha}<span class="material-symbols-outlined">${iconName}</span></div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -18],
    });
  }

  function coordenadaValida(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    return lat != null && lng != null && Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  }

  function colocarMarcador(clave, tipo, coord, popup, rumbo) {
    if (!coord || !seguimiento.mapa) return null;
    let marcador = seguimiento.marcadores[clave];
    if (!marcador) {
      marcador = L.marker(coord, { icon: iconoSeguimiento(tipo, rumbo) }).addTo(seguimiento.mapa);
      seguimiento.marcadores[clave] = marcador;
    } else {
      marcador.setLatLng(coord);
    }
    if (popup) marcador.bindPopup(popup);
    return marcador;
  }

  function ajustarVistaSeguimiento() {
    if (!seguimiento.mapa) return;
    const puntos = Object.values(seguimiento.marcadores).map((m) => m.getLatLng());
    if (puntos.length === 0) return;
    if (puntos.length === 1) {
      seguimiento.mapa.setView(puntos[0], 15);
    } else {
      seguimiento.mapa.fitBounds(L.latLngBounds(puntos), { padding: [45, 45], maxZoom: 16 });
    }
  }

  function actualizarBadgeEstadoSeguimiento(estadoPedido) {
    const el = document.getElementById("tracking-estado");
    if (!el) return;
    const e = String(estadoPedido || "PENDIENTE");
    el.className = `mm-badge ${e.toLowerCase()}`;
    el.textContent = e.replace(/_/g, " ");
  }

  function refrescarInfoSeguimiento(datos) {
    const info = document.getElementById("tracking-info");
    if (!info) return;
    const rep = datos && datos.repartidor;
    const dest = datos && datos.destino;
    const suc = datos && datos.sucursal;

    const tarjeta = (titulo, cuerpo) => `
      <div class="rounded-xl border border-[#e8e2dc] bg-[#faf8f5] p-3">
        <span class="mm-eyebrow block">${titulo}</span>
        <div class="mt-1 text-[#1f2421]">${cuerpo}</div>
      </div>`;

    const bloqueRep = rep
      ? `<strong>${escapar(rep.nombre || "Repartidor")}</strong>${
          rep.telefono
            ? `<br><a class="font-semibold text-[#d95b00] underline" href="tel:${escapar(
                rep.telefono
              )}">${escapar(rep.telefono)}</a>`
            : ""
        }<br><span id="tracking-hace" class="text-[#68706c]">${
          seguimiento.ultimaActualizacion
            ? `Ubicación ${formatearHace(Date.now() - seguimiento.ultimaActualizacion)}`
            : "Esperando ubicación..."
        }</span>`
      : `<span class="text-[#68706c]">Aún no hay un repartidor asignado.</span>`;

    const bloqueDest = dest
      ? `<strong>${escapar(dest.detalle_direccion || "")}</strong>${
          dest.municipio ? `<br><span class="text-[#68706c]">${escapar(dest.municipio)}</span>` : ""
        }`
      : `<span class="text-[#68706c]">Retiro en sucursal.</span>`;

    const bloqueSuc = suc
      ? `<strong>${escapar(suc.nombre || "")}</strong><br><span class="text-[#68706c]">${escapar(
          suc.direccion || ""
        )}</span>`
      : "";

    info.innerHTML =
      tarjeta("Repartidor", bloqueRep) +
      tarjeta("Entrega en", bloqueDest) +
      tarjeta("Sale de", bloqueSuc);
  }

  function aplicarSeguimiento(datos) {
    if (!datos || !seguimiento.mapa) return;
    const titulo = document.getElementById("tracking-title");
    if (titulo) titulo.textContent = `Pedido ${datos.codigo_pedido || `#${datos.id_pedido}`}`;
    actualizarBadgeEstadoSeguimiento(datos.estado);

    const suc = datos.sucursal;
    if (suc) {
      colocarMarcador(
        "sucursal",
        "sucursal",
        coordenadaValida(suc.latitud, suc.longitud),
        `<strong>${escapar(suc.nombre || "Sucursal")}</strong><br>${escapar(suc.direccion || "")}`
      );
    }
    const dest = datos.destino;
    if (dest) {
      colocarMarcador(
        "destino",
        "destino",
        coordenadaValida(dest.latitud, dest.longitud),
        `<strong>Tu dirección</strong><br>${escapar(dest.detalle_direccion || "")}`
      );
    }
    const rep = datos.repartidor;
    seguimiento.tieneRepartidor = Boolean(rep);
    if (rep) {
      const coord = coordenadaValida(rep.latitud, rep.longitud);
      if (rep.ultima_actualizacion) {
        const t = Date.parse(rep.ultima_actualizacion);
        if (Number.isFinite(t)) seguimiento.ultimaActualizacion = t;
      }
      if (coord) {
        colocarMarcador(
          "repartidor",
          "moto",
          coord,
          `<strong>${escapar(rep.nombre || "Repartidor")}</strong>`
        );
      }
    }

    if (datos.tipo_entrega === "RETIRO") {
      avisoSeguimiento("Este pedido es para retiro en sucursal, no hay repartidor en camino.", false);
    } else if (!rep) {
      avisoSeguimiento("Estamos asignando un repartidor a tu pedido. El mapa se actualizará solo.", false);
    } else if (!coordenadaValida(rep.latitud, rep.longitud)) {
      avisoSeguimiento("Tu repartidor aún no ha compartido su ubicación.", false);
    } else {
      avisoSeguimiento("", false);
    }

    ajustarVistaSeguimiento();
    refrescarInfoSeguimiento(datos);
  }

  function moverRepartidor(lat, lng, rumbo, ultima) {
    const coord = coordenadaValida(lat, lng);
    if (!coord || !seguimiento.mapa) return;
    const marcador = seguimiento.marcadores.repartidor;
    seguimiento.tieneRepartidor = true;
    seguimiento.ultimaActualizacion = Number.isFinite(Date.parse(ultima))
      ? Date.parse(ultima)
      : Date.now();
    avisoSeguimiento("", false);

    if (!marcador) {
      colocarMarcador("repartidor", "moto", coord, "<strong>Repartidor</strong>", rumbo);
      ajustarVistaSeguimiento();
    } else {
      const origen = marcador.getLatLng();
      cancelAnimationFrame(seguimiento.anim);
      const t0 = performance.now();
      const DURACION = 1200;
      const paso = (t) => {
        const k = Math.min(1, (t - t0) / DURACION);
        marcador.setLatLng([
          origen.lat + (coord[0] - origen.lat) * k,
          origen.lng + (coord[1] - origen.lng) * k,
        ]);
        if (k < 1 && !seguimiento.cerrado) seguimiento.anim = requestAnimationFrame(paso);
      };
      seguimiento.anim = requestAnimationFrame(paso);
      if (!seguimiento.mapa.getBounds().contains(coord)) {
        seguimiento.mapa.panTo(coord);
      }
    }

    if (rumbo != null && marcador) {
      const flecha = marcador.getElement() && marcador.getElement().querySelector(".mm-pin-flecha");
      if (flecha) flecha.style.transform = `rotate(${Number(rumbo) || 0}deg)`;
    }
    const hace = document.getElementById("tracking-hace");
    if (hace) hace.textContent = "Ubicación ahora mismo";
  }

  function manejarMensajeSeguimiento(ev) {
    if (typeof ev.data === "string" && ev.data === "pong") return;
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    switch (msg.evento) {
      case "estado_inicial":
        aplicarSeguimiento(msg.datos);
        break;
      case "posicion_actualizada":
        moverRepartidor(msg.latitud, msg.longitud, msg.rumbo, msg.ultima_actualizacion);
        break;
      case "estado_pedido_actualizado":
        actualizarBadgeEstadoSeguimiento(msg.estado);
        if (msg.estado === "ENTREGADO") mostrarToast("¡Tu pedido fue entregado! Gracias por comprar.");
        if (msg.estado === "CANCELADO") mostrarToast("Tu pedido fue cancelado.");
        if (msg.estado === "EN_RUTA") mostrarToast("¡Tu pedido va en camino!");
        break;
      case "pago_confirmado":
        mostrarToast(
          `Pago confirmado${msg.monto != null ? ` por $${Number(msg.monto).toFixed(2)}` : ""}.`
        );
        break;
      default:
        break;
    }
  }

  function conectarWsSeguimiento() {
    if (seguimiento.cerrado || !estado.sesion || !estado.sesion.token) return;
    const url = `${obtenerWsBase()}/pedidos/${seguimiento.idPedido}/ws/seguimiento?token=${encodeURIComponent(
      estado.sesion.token
    )}`;
    estadoConexionSeguimiento(false, seguimiento.intentos === 0 ? "Conectando..." : "Reconectando...");

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      programarReconexionSeguimiento();
      return;
    }
    seguimiento.ws = ws;

    ws.onopen = () => {
      seguimiento.intentos = 0;
      estadoConexionSeguimiento(true, "En vivo");
      clearInterval(seguimiento.timerPing);
      seguimiento.timerPing = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, WS_PING_MS);
    };
    ws.onmessage = manejarMensajeSeguimiento;
    ws.onclose = (e) => {
      clearInterval(seguimiento.timerPing);
      if (seguimiento.cerrado) return;
      if (e && e.code === 1008) {
        estadoConexionSeguimiento(false, "Sin conexión");
        avisoSeguimiento(
          "No se pudo abrir el seguimiento (sesión vencida o sin permisos). Inicia sesión de nuevo.",
          true
        );
        return;
      }
      programarReconexionSeguimiento();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch (_) {}
    };
  }

  function programarReconexionSeguimiento() {
    if (seguimiento.cerrado) return;
    estadoConexionSeguimiento(false, "Reconectando...");
    const espera = Math.min(30000, 1000 * Math.pow(2, seguimiento.intentos));
    seguimiento.intentos += 1;
    clearTimeout(seguimiento.timerReconexion);
    seguimiento.timerReconexion = setTimeout(conectarWsSeguimiento, espera);
  }

  async function abrirSeguimientoPedido(idPedido) {
    if (!estado.sesion || !estado.sesion.token) {
      mostrarToast("Inicia sesión para ver el seguimiento de tu pedido.");
      return;
    }
    if (typeof L === "undefined") {
      mostrarToast("No se pudo cargar el mapa. Revisa tu conexión a internet e inténtalo de nuevo.");
      return;
    }
    asegurarModalSeguimiento();
    cerrarSeguimiento();
    seguimiento.cerrado = false;
    seguimiento.idPedido = Number(idPedido);
    seguimiento.intentos = 0;

    document.getElementById("tracking-title").textContent = "Tu pedido";
    document.getElementById("tracking-info").innerHTML = "";
    avisoSeguimiento("", false);
    actualizarBadgeEstadoSeguimiento("PENDIENTE");
    estadoConexionSeguimiento(false, "Conectando...");

    document.getElementById("tracking-modal").classList.add("open");

    seguimiento.mapa = L.map("tracking-map", { zoomControl: true }).setView([13.4833, -88.1833], 13);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, METI, TomTom",
      }
    ).addTo(seguimiento.mapa);
    setTimeout(() => {
      if (seguimiento.mapa) seguimiento.mapa.invalidateSize();
    }, 260);

    // Reloj para "Ubicación hace X s"
    seguimiento.timerReloj = setInterval(() => {
      const el = document.getElementById("tracking-hace");
      if (el && seguimiento.ultimaActualizacion) {
        el.textContent = `Ubicación ${formatearHace(Date.now() - seguimiento.ultimaActualizacion)}`;
      }
    }, 1000);

    try {
      const datos = await peticionApi(
        `/pedidos/${seguimiento.idPedido}/seguimiento`,
        { headers: { Authorization: `Bearer ${estado.sesion.token}` } },
        10000
      );
      if (seguimiento.cerrado) return;
      aplicarSeguimiento(datos);
    } catch (err) {
      if (seguimiento.cerrado) return;
      avisoSeguimiento(
        err && err.status === 401
          ? "Tu sesión expiró. Inicia sesión de nuevo para ver el seguimiento."
          : (err && err.message) || "No se pudo cargar el seguimiento del pedido.",
        true
      );
      if (err && err.status) return;
    }
    conectarWsSeguimiento();
  }

  // ─── Modal "Mis Pedidos" (/pedidos/mis-pedidos) y Cuadro de Espera de Correo ─

  function asegurarModalesGlobales() {
    if (!document.getElementById("orders-modal")) {
      const div = document.createElement("div");
      div.id = "orders-modal";
      div.className =
        "overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4";
      div.innerHTML = `
        <div class="mm-panel relative w-full max-w-2xl border-t-4 border-t-[#f67300] p-6 shadow-2xl">
          <button type="button" id="orders-modal-close" aria-label="Cerrar" class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#faf8f5] text-[#68706c] hover:text-[#1f2421]">✕</button>
          <p class="mm-eyebrow mb-1">HISTORIAL DE COMPRAS</p>
          <h3 class="text-xl font-extrabold text-[#1f2421]">Mis pedidos en MiniMarket</h3>
          <div id="orders-modal-body" class="mt-4 max-h-[65vh] space-y-3 overflow-y-auto pr-1"></div>
        </div>
      `;
      document.body.appendChild(div);
      div.addEventListener("click", (e) => {
        if (e.target === div) div.classList.remove("open");
      });
      document
        .getElementById("orders-modal-close")
        .addEventListener("click", () => div.classList.remove("open"));
    }

    if (!document.getElementById("verify-wait-modal")) {
      const divWait = document.createElement("div");
      divWait.id = "verify-wait-modal";
      divWait.className =
        "overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4";
      divWait.innerHTML = `
        <div class="mm-panel relative w-full max-w-md border-t-4 border-t-[#f67300] p-6 text-center shadow-2xl">
          <button type="button" id="verify-wait-close" aria-label="Cerrar" class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#faf8f5] text-[#68706c] hover:text-[#1f2421]">✕</button>
          <div id="verify-wait-icon" class="mx-auto mb-4 flex h-14 w-14 items-center justify-center">
            <div class="mm-spinner"></div>
          </div>
          <h3 id="verify-wait-title" class="text-lg font-extrabold text-[#1f2421]">
            Esperando verificación de tu correo
          </h3>
          <p id="verify-wait-desc" class="mt-2 text-xs leading-relaxed text-[#68706c]"></p>
          <div id="verify-wait-status" class="mt-4 rounded-lg border border-[#ffd8b5] bg-[#fff3e6] px-3 py-2 text-xs font-semibold text-[#d95b00]">
            Esperando confirmación desde tu correo electrónico...
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#e8e2dc] pt-4 text-xs">
            <button type="button"
                    id="verify-resend-btn"
                    class="font-bold text-[#d95b00] underline hover:text-[#f67300]">
              Reenviar correo de verificación
            </button>
            <a href="login.html" class="font-semibold text-[#68706c] hover:text-[#1f2421]">
              Ir a iniciar sesión →
            </a>
          </div>
        </div>
      `;
      document.body.appendChild(divWait);
      document
        .getElementById("verify-wait-close")
        .addEventListener("click", cerrarModalEsperaVerificacion);
    }
  }

  function cerrarModalEsperaVerificacion() {
    if (estado.timerVerificacion) {
      clearInterval(estado.timerVerificacion);
      estado.timerVerificacion = null;
    }
    const modal = document.getElementById("verify-wait-modal");
    if (modal) modal.classList.remove("open");
  }

  function completarVerificacionYRedirigir(email) {
    if (estado.timerVerificacion) {
      clearInterval(estado.timerVerificacion);
      estado.timerVerificacion = null;
    }

    const iconBox = document.getElementById("verify-wait-icon");
    const titleEl = document.getElementById("verify-wait-title");
    const statusEl = document.getElementById("verify-wait-status");
    if (iconBox) {
      iconBox.innerHTML = `
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-[#dcfce7] text-2xl font-extrabold text-[#16a34a]">
          ✓
        </div>
      `;
    }
    if (titleEl) titleEl.textContent = "¡Correo verificado con éxito!";
    if (statusEl) {
      statusEl.className =
        "mt-3 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-xs font-bold text-[#166534]";
      statusEl.textContent = "Cerrando ventana y redirigiendo a iniciar sesión...";
    }

    setTimeout(() => {
      cerrarModalEsperaVerificacion();
      window.location.href = `login.html?verificado=1&email=${encodeURIComponent(email)}`;
    }, 950);
  }

  function abrirModalEsperaVerificacion(email, password) {
    asegurarModalesGlobales();
    if (estado.timerVerificacion) {
      clearInterval(estado.timerVerificacion);
      estado.timerVerificacion = null;
    }

    const modal = document.getElementById("verify-wait-modal");
    const iconBox = document.getElementById("verify-wait-icon");
    const titleEl = document.getElementById("verify-wait-title");
    const descEl = document.getElementById("verify-wait-desc");
    const statusEl = document.getElementById("verify-wait-status");
    const btnResend = document.getElementById("verify-resend-btn");

    if (iconBox) iconBox.innerHTML = `<div class="mm-spinner"></div>`;
    if (titleEl) titleEl.textContent = "Esperando verificación de tu correo";
    if (descEl) {
      descEl.innerHTML = `Enviamos un enlace de activación a <strong class="text-[#1f2421]">${escapar(
        email
      )}</strong>. Confirma tu cuenta desde tu correo; en cuanto lo hagas, esta ventana se cerrará sola y te llevará a iniciar sesión.`;
    }
    if (statusEl) {
      statusEl.className =
        "mt-3 rounded-lg border border-[#ffd8b5] bg-[#fff3e6] px-3 py-2 text-xs font-semibold text-[#d95b00]";
      statusEl.textContent = "Esperando confirmación desde tu correo electrónico...";
    }
    if (btnResend) {
      btnResend.onclick = async () => {
        try {
          const r = await peticionApi(
            "/auth/reenviar-verificacion",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            },
            10000
          );
          statusEl.textContent =
            r.mensaje || "Se ha enviado un nuevo enlace de verificación a tu correo.";
        } catch (err) {
          statusEl.textContent =
            err.message || "Problemas de conexión al reenviar el correo.";
        }
      };
    }

    modal.classList.add("open");

    // Sondeo cada 8 s. Usa /auth/estado-verificacion si el servidor lo ofrece;
    // si no (404), comprueba con /auth/login: responde 403 mientras no esté verificado y 200 al verificar.
    // 8 s mantiene el ritmo por debajo del límite de 10 intentos/minuto del login.
    let usarEndpointEstado = true;
    let consultando = false;
    estado.timerVerificacion = setInterval(async () => {
      if (consultando) return;
      consultando = true;
      try {
        if (usarEndpointEstado) {
          try {
            const est = await peticionApi(
              `/auth/estado-verificacion?email=${encodeURIComponent(email)}`,
              null,
              4500
            );
            if (est && est.email_verificado === true) {
              completarVerificacionYRedirigir(email);
            }
            return;
          } catch (err) {
            if (!(err && err.status === 404)) return;
            usarEndpointEstado = false;
          }
        }

        if (!password) return;
        try {
          const form = new URLSearchParams();
          form.set("username", email);
          form.set("password", password);
          const tok = await peticionApi(
            "/auth/login",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: form.toString(),
            },
            5000
          );
          if (tok && tok.access_token) {
            completarVerificacionYRedirigir(email);
          }
        } catch (_) {
          // 403 = aún sin verificar; seguimos esperando
        }
      } finally {
        consultando = false;
      }
    }, 8000);
  }

  // ─── [BLOQUE 13] Modal de historial de pedidos ("Mis pedidos") y cancelación ─

  async function abrirModalMisPedidos() {
    asegurarModalesGlobales();
    const modal = document.getElementById("orders-modal");
    const body = document.getElementById("orders-modal-body");
    modal.classList.add("open");

    if (!estado.sesion || !estado.sesion.token) {
      body.innerHTML = `<p class="text-sm text-[#68706c]">Inicia sesión para consultar tus pedidos.</p>`;
      return;
    }

    body.innerHTML = `<p class="text-xs text-[#68706c]">Cargando tu historial de pedidos...</p>`;
    try {
      const pedidos = await peticionApi(
        "/pedidos/mis-pedidos",
        {
          headers: { Authorization: `Bearer ${estado.sesion.token}` },
        },
        10000
      );

      if (!Array.isArray(pedidos) || pedidos.length === 0) {
        body.innerHTML = `<p class="py-8 text-center text-sm text-[#68706c]">Aún no tienes pedidos registrados con esta cuenta.</p>`;
        return;
      }

      body.innerHTML = pedidos
        .map((p) => {
          const claseEstado = String(p.estado || "PENDIENTE").toLowerCase();
          const codigo = p.codigo_pedido || `#${p.id_pedido}`;
          const fecha = p.fecha_creacion
            ? new Date(p.fecha_creacion).toLocaleString("es-SV")
            : "";
          return `
            <div class="rounded-xl border border-[#e8e2dc] bg-[#faf8f5] p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span class="font-extrabold text-[#1f2421]">${escapar(codigo)}</span>
                  <span class="ml-2 text-xs text-[#68706c]">${escapar(fecha)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="mm-badge ${escapar(claseEstado)}">${escapar(p.estado)}</span>
                  <span class="text-sm font-extrabold text-[#f67300]">$${Number(
                    p.total
                  ).toFixed(2)}</span>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#68706c]">
                <span>Entrega: <strong class="text-[#1f2421]">${escapar(
                  p.tipo_entrega
                )}</strong></span>
                <span>Pago: <strong class="text-[#1f2421]">${escapar(
                  etiquetaMetodoPago(p.metodo_pago)
                )} (${escapar(p.estado_pago)})</strong></span>
                ${
                  p.nombre_repartidor
                    ? `<span>Repartidor: <strong class="text-[#d95b00]">${escapar(
                        p.nombre_repartidor
                      )}</strong></span>`
                    : ""
                }
              </div>
              <ul class="mt-2.5 space-y-1 border-t border-[#e8e2dc] pt-2 text-xs text-[#1f2421]">
                ${(p.detalles || [])
                  .map(
                    (d) =>
                      `<li class="flex justify-between"><span>${Number(
                        d.cantidad
                      )}x ${escapar(d.nombre_producto)}</span><span class="font-semibold">$${Number(
                        d.subtotal
                      ).toFixed(2)}</span></li>`
                  )
                  .join("")}
              </ul>
              <div class="mt-3 flex flex-wrap justify-end gap-2">
                ${
                  p.tipo_entrega === "DOMICILIO" &&
                  !["ENTREGADO", "CANCELADO"].includes(String(p.estado))
                    ? `<button type="button"
                        data-track-order="${Number(p.id_pedido)}"
                        class="mm-btn-primary px-3 py-1 text-[11px]">
                  Seguir en vivo
                </button>`
                    : ""
                }
                ${
                  String(p.metodo_pago) === "TARJETA" &&
                  String(p.estado_pago) !== "PAGADO" &&
                  String(p.estado) !== "CANCELADO"
                    ? `<button type="button"
                        data-pay-order="${Number(p.id_pedido)}"
                        data-pay-code="${escapar(codigo)}"
                        data-pay-total="${Number(p.total) || 0}"
                        class="mm-btn-primary px-3 py-1 text-[11px]">
                  Pagar con tarjeta
                </button>`
                    : ""
                }
                <button type="button"
                        data-send-invoice="${p.id_pedido}"
                        class="mm-btn-secondary px-3 py-1 text-[11px]">
                  Enviar factura a mi correo
                </button>
              </div>
            </div>
          `;
        })
        .join("");

      body.querySelectorAll("[data-track-order]").forEach((btn) => {
        btn.addEventListener("click", () => {
          modal.classList.remove("open");
          abrirSeguimientoPedido(btn.getAttribute("data-track-order"));
        });
      });

      body.querySelectorAll("[data-pay-order]").forEach((btn) => {
        btn.addEventListener("click", () => {
          modal.classList.remove("open");
          abrirModalPagoTarjeta({
            id_pedido: Number(btn.getAttribute("data-pay-order")),
            codigo_pedido: btn.getAttribute("data-pay-code"),
            total: Number(btn.getAttribute("data-pay-total")) || 0,
          });
        });
      });

      body.querySelectorAll("[data-send-invoice]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const idPed = btn.getAttribute("data-send-invoice");
          try {
            const r = await peticionApi(
              `/pedidos/${idPed}/enviar-factura`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${estado.sesion.token}` },
              },
              10000
            );
            mostrarToast(r.mensaje || "Factura enviada al correo.");
          } catch (err) {
            mostrarToast(
              err.message ||
                "Problemas de conexión al reenviar la factura. Inténtalo nuevamente."
            );
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="mm-alert error">${escapar(
        err.message ||
          "Problemas de conexión al consultar tus pedidos. Inténtalo nuevamente."
      )}</div>`;
    }
  }

  // ─── [BLOQUE 14] Autenticación, inicio de sesión y registro ────────────────

  function inicializarPaginaLogin() {
    const form = document.getElementById("login-form");
    if (!form) return;

    const alerta = document.getElementById("login-alert");
    const inputEmail = document.getElementById("login-usuario");
    const inputPwd = document.getElementById("login-password");
    const btnSubmit = document.getElementById("login-submit-btn");
    const btnOlvide = document.getElementById("forgot-password-btn");
    const boxOlvide = document.getElementById("forgot-password-box");
    const btnEnviarReset = document.getElementById("forgot-send-btn");

    const params = new URLSearchParams(window.location.search);
    if (params.get("email") && inputEmail) {
      inputEmail.value = params.get("email");
    }
    if (params.get("verificado") === "1") {
      mostrarAlertaForm(
        alerta,
        "¡Tu correo electrónico ha sido verificado! Ingresa tu contraseña para iniciar sesión.",
        false
      );
      if (inputPwd) inputPwd.focus();
    }

    if (btnOlvide && boxOlvide) {
      btnOlvide.addEventListener("click", (e) => {
        e.preventDefault();
        boxOlvide.classList.toggle("hidden");
      });
    }

    if (btnEnviarReset) {
      btnEnviarReset.addEventListener("click", async () => {
        const emailReset = validarEmail(
          document.getElementById("forgot-email-input").value || inputEmail.value
        );
        if (!emailReset) {
          mostrarAlertaForm(
            alerta,
            "Ingresa un correo válido para recuperar tu contraseña.",
            true
          );
          return;
        }
        try {
          const r = await peticionApi(
            "/auth/olvide-contrasena",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: emailReset }),
            },
            10000
          );
          mostrarAlertaForm(
            alerta,
            r.mensaje || "Si el correo está registrado, recibirás un enlace de recuperación.",
            false
          );
          boxOlvide.classList.add("hidden");
        } catch (err) {
          mostrarAlertaForm(
            alerta,
            err.message ||
              "Problemas de conexión al solicitar la recuperación de contraseña.",
            true
          );
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      alerta.className = "hidden";

      const emailLimpio = validarEmail(inputEmail.value);
      const pwdInput = inputPwd.value || "";

      if (!emailLimpio) {
        mostrarAlertaForm(alerta, "Ingresa un correo electrónico válido.", true);
        return;
      }
      if (pwdInput.length < 8) {
        mostrarAlertaForm(alerta, "Ingresa tu contraseña (mínimo 8 caracteres).", true);
        return;
      }

      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = "Iniciando sesión...";
      }

      try {
        const cuerpoForm = new URLSearchParams();
        cuerpoForm.set("username", emailLimpio);
        cuerpoForm.set("password", pwdInput);

        const tokenData = await peticionApi(
          "/auth/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: cuerpoForm.toString(),
          },
          12000
        );

        let nombreUsuario = emailLimpio.split("@")[0];
        try {
          const perfil = await peticionApi(
            "/auth/me",
            {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            },
            7000
          );
          if (perfil && perfil.nombre_completo) nombreUsuario = perfil.nombre_completo;
        } catch (_) {}

        estado.sesion = {
          token: tokenData.access_token,
          id_usuario: tokenData.id_usuario,
          rol: tokenData.rol,
          email: emailLimpio,
          nombre: nombreUsuario,
        };
        guardarStorage(STORAGE_AUTH, estado.sesion);
        mostrarAlertaForm(
          alerta,
          "¡Bienvenido! Redirigiendo al catálogo...",
          false
        );
        setTimeout(() => {
          window.location.href = "index.html";
        }, 550);
      } catch (err) {
        const msg =
          err.message ||
          "Problemas de conexión con el servidor. Inténtalo nuevamente.";
        mostrarAlertaForm(alerta, msg, true);

        if (msg.toLowerCase().includes("verificar")) {
          abrirModalEsperaVerificacion(emailLimpio, pwdInput);
        }
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = "Iniciar Sesión";
        }
      }
    });
  }

  // ─── Registro de Cliente (/auth/registro) ───────────────────────────────────

  function inicializarPaginaRegistro() {
    const form = document.getElementById("registro-form");
    if (!form) return;

    const alerta = document.getElementById("registro-alert");
    const btnSubmit = document.getElementById("registro-submit-btn");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      alerta.className = "hidden";

      const nombreCompleto = limpiarTexto(
        document.getElementById("reg-nombre-completo").value,
        150
      );
      const email = validarEmail(document.getElementById("reg-email").value);
      const telRaw = limpiarTexto(document.getElementById("reg-telefono").value, 20);
      const telefono = telRaw ? telRaw : null;
      const pwd = document.getElementById("reg-password").value;

      if (nombreCompleto.length < 2) {
        mostrarAlertaForm(
          alerta,
          "Ingresa tu nombre completo (mínimo 2 caracteres).",
          true
        );
        return;
      }
      if (!email) {
        mostrarAlertaForm(
          alerta,
          "Ingresa una dirección de correo electrónico válida.",
          true
        );
        return;
      }
      const errPwd = validarPassword(pwd);
      if (errPwd) {
        mostrarAlertaForm(alerta, errPwd, true);
        return;
      }

      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = "Creando cuenta...";
      }

      try {
        await peticionApi(
          "/auth/registro",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nombre_completo: nombreCompleto,
              email: email,
              password: pwd,
              telefono: telefono,
            }),
          },
          15000
        );

        form.reset();
        abrirModalEsperaVerificacion(email, pwd);
      } catch (err) {
        mostrarAlertaForm(
          alerta,
          err.message ||
            "Problemas de conexión con el servidor. No se pudo completar el registro en este momento.",
          true
        );
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = "Crear cuenta";
        }
      }
    });
  }

  function mostrarAlertaForm(el, texto, esError) {
    if (!el) return;
    el.textContent = texto;
    el.className = esError ? "mm-alert error mb-4" : "mm-alert mb-4";
  }

  // ─── Utilidades UI y eventos globales ───────────────────────────────────────

  function mostrarToast(mensaje) {
    let toast = document.getElementById("mm-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "mm-toast";
      toast.className =
        "fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#ffd8b5] bg-[#1f2421] px-5 py-2.5 text-xs font-semibold text-white shadow-xl transition-opacity duration-200";
      document.body.appendChild(toast);
    }
    toast.textContent = mensaje;
    toast.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.style.opacity = "0";
    }, 2800);
  }

  function enlazarEventosGlobales() {
    asegurarModalesGlobales();

    const btnHeaderOrders = document.getElementById("header-orders-btn");
    if (btnHeaderOrders) {
      btnHeaderOrders.addEventListener("click", (e) => {
        e.preventDefault();
        abrirModalMisPedidos();
      });
    }

    document.querySelectorAll("[data-toggle-pwd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.getAttribute("data-toggle-pwd"));
        if (target) {
          target.type = target.type === "password" ? "text" : "password";
        }
      });
    });

    const formSearch = document.getElementById("header-search-form");
    if (formSearch) {
      formSearch.addEventListener("submit", (e) => {
        e.preventDefault();
        const valor = limpiarTexto(
          document.getElementById("header-search-input").value,
          100
        );
        if (!document.getElementById("vista-inicio")) {
          window.location.href = `index.html?q=${encodeURIComponent(valor)}`;
          return;
        }
        estado.busqueda = valor;
        estado.paginaActual = 1;
        estado.vistaActual = "catalogo";
        actualizarVistasIndex();
      });
    }

    const selSucursal = document.getElementById("header-sucursal-select");
    if (selSucursal) {
      selSucursal.addEventListener("change", () => {
        estado.idSucursalActiva = Number(selSucursal.value);
        guardarStorage(STORAGE_SUCURSAL, estado.idSucursalActiva);
        mostrarToast(
          `Sucursal activa: ${selSucursal.options[selSucursal.selectedIndex].text}`
        );
      });
    }

    const btnLogout = document.getElementById("header-logout-btn");
    if (btnLogout) {
      btnLogout.addEventListener("click", () => {
        estado.sesion = null;
        estado.direccionesCliente = [];
        estado.direccionesCargadas = false;
        localStorage.removeItem(STORAGE_AUTH);
        renderizarSesionHeader();
        mostrarToast("Sesión cerrada.");
      });
    }

    const btnCartOpen = document.getElementById("header-cart-btn");
    if (btnCartOpen) btnCartOpen.addEventListener("click", abrirCarrito);
    const btnCartClose = document.getElementById("cart-close-btn");
    if (btnCartClose) btnCartClose.addEventListener("click", cerrarCarrito);
    const cartOverlay = document.getElementById("cart-overlay");
    if (cartOverlay) cartOverlay.addEventListener("click", cerrarCarrito);
    const btnCheckout = document.getElementById("cart-checkout-btn");
    if (btnCheckout) btnCheckout.addEventListener("click", procesarPagoCarrito);

    const btnMegaClose = document.getElementById("mega-menu-close");
    if (btnMegaClose) btnMegaClose.addEventListener("click", cerrarMegaMenu);

    const btnModalClose = document.getElementById("product-detail-close");
    if (btnModalClose) btnModalClose.addEventListener("click", cerrarModalDetalleProducto);
    const modalDetalle = document.getElementById("product-detail-modal");
    if (modalDetalle) {
      modalDetalle.addEventListener("click", (e) => {
        if (e.target === modalDetalle) cerrarModalDetalleProducto();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cerrarCarrito();
        cerrarMegaMenu();
        cerrarModalDetalleProducto();
        const om = document.getElementById("orders-modal");
        if (om) om.classList.remove("open");
      }
    });

    const btnVolverInicio = document.getElementById("btn-volver-inicio");
    if (btnVolverInicio) {
      btnVolverInicio.addEventListener("click", () => {
        estado.vistaActual = "inicio";
        estado.busqueda = "";
        estado.paginaActual = 1;
        estado.categoriasSeleccionadas.clear();
        actualizarVistasIndex();
      });
    }

    const selectOrden = document.getElementById("catalog-sort-select");
    if (selectOrden) {
      selectOrden.addEventListener("change", () => {
        estado.orden = selectOrden.value;
        estado.paginaActual = 1;
        renderizarResultadosCatalogo();
      });
    }

    document.querySelectorAll("[data-price-bucket]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const key = chk.getAttribute("data-price-bucket");
        if (chk.checked) estado.rangosPrecioCheck.add(key);
        else estado.rangosPrecioCheck.delete(key);
        estado.paginaActual = 1;
        renderizarResultadosCatalogo();
      });
    });

    const btnAplicarPrecio = document.getElementById("btn-apply-minmax");
    if (btnAplicarPrecio) {
      btnAplicarPrecio.addEventListener("click", () => {
        const minTxt = document.getElementById("input-min-price").value.trim();
        const maxTxt = document.getElementById("input-max-price").value.trim();
        const errBox = document.getElementById("price-filter-error");

        const minVal = minTxt === "" ? null : Number(minTxt);
        const maxVal = maxTxt === "" ? null : Number(maxTxt);

        if (
          (minVal !== null && (isNaN(minVal) || minVal < 0)) ||
          (maxVal !== null && (isNaN(maxVal) || maxVal < 0))
        ) {
          errBox.textContent = "Ingresa montos positivos válidos.";
          errBox.classList.remove("hidden");
          return;
        }
        if (minVal !== null && maxVal !== null && minVal > maxVal) {
          errBox.textContent = "El mínimo no puede superar al máximo.";
          errBox.classList.remove("hidden");
          return;
        }
        errBox.classList.add("hidden");
        estado.precioMin = minVal;
        estado.precioMax = maxVal;
        estado.paginaActual = 1;
        renderizarResultadosCatalogo();
      });
    }

    const btnLimpiarFiltros = document.getElementById("btn-reset-filters");
    if (btnLimpiarFiltros) {
      btnLimpiarFiltros.addEventListener("click", () => {
        estado.categoriasSeleccionadas.clear();
        estado.rangosPrecioCheck.clear();
        estado.precioMin = null;
        estado.precioMax = null;
        estado.busqueda = "";
        estado.paginaActual = 1;
        estado.tituloResultado = `Catálogo completo (${estado.productos.length} productos)`;
        const inMin = document.getElementById("input-min-price");
        const inMax = document.getElementById("input-max-price");
        const inQ = document.getElementById("header-search-input");
        if (inMin) inMin.value = "";
        if (inMax) inMax.value = "";
        if (inQ) inQ.value = "";
        renderizarSidebarFiltros();
        renderizarResultadosCatalogo();
        renderizarBarraCategorias();
      });
    }

    document.querySelectorAll("[data-collapse-btn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.getAttribute("data-collapse-btn"));
        if (!target) return;
        const oculto = target.classList.toggle("hidden");
        btn.textContent = oculto ? "+" : "−";
      });
    });
  }

  function leerParametrosInicialesUrl() {
    if (!document.getElementById("vista-inicio")) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("categoria")) {
      const id = Number(params.get("categoria"));
      if (id > 0) {
        estado.vistaActual = "catalogo";
        estado.paginaActual = 1;
        estado.categoriasSeleccionadas = new Set([id]);
      }
    } else if (params.get("q")) {
      estado.busqueda = limpiarTexto(params.get("q"), 100);
      estado.vistaActual = "catalogo";
      estado.paginaActual = 1;
      const inQ = document.getElementById("header-search-input");
      if (inQ) inQ.value = estado.busqueda;
    } else if (params.get("catalogo") === "1") {
      estado.vistaActual = "catalogo";
      estado.paginaActual = 1;
      estado.tituloResultado = `Catálogo completo (${estado.productos.length} productos)`;
    }
  }

  // ─── [BLOQUE 15] Enlace de eventos globales e inicialización del DOM ───────

  document.addEventListener("DOMContentLoaded", async () => {
    enlazarEventosGlobales();
    inicializarPaginaLogin();
    inicializarPaginaRegistro();
    renderizarSesionHeader();
    renderizarSucursalHeader();
    renderizarBarraCategorias();
    renderizarResumenHeaderCarrito();
    leerParametrosInicialesUrl();
    actualizarVistasIndex();

    if (window.location.search.includes("ver=categorias")) {
      alternarMegaMenu();
    }

    await inicializarDatosAPI();
    renderizarSucursalHeader();
    renderizarBarraCategorias();
    renderizarResumenHeaderCarrito();
    actualizarVistasIndex();
  });
})();
