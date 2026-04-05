// FICHAJES v0.7.0 — app.js
const GOOGLE_CLIENT_ID = '920497100034-08on4kifjrp7l80doe6ucs49ahop5v8c.apps.googleusercontent.com';
const tg    = window.Telegram?.WebApp;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
// Ring: usamos paths SVG calculados, no dasharray/transforms

const state = {
  empleado: null, ubicacion: null, estadoHoy: null,
  timerInterval: null, timerSeconds: 0,
  ringInterval: null,
  empleados: [], ubicaciones: [], config: {}
};

// ── CACHE ─────────────────────────────────────────────────────────
function cacheSet(k, v) { try { localStorage.setItem(k, JSON.stringify({ v, t: Date.now() })); } catch(e){} }
function cacheGet(k, ttl) {
  try {
    const raw = localStorage.getItem(k); if (!raw) return null;
    const o = JSON.parse(raw);
    if (ttl && Date.now() - o.t > ttl) return null;
    return o.v;
  } catch(e) { return null; }
}

// ── API ───────────────────────────────────────────────────────────
async function api(action, data = {}) {
  const telegramId  = tg?.initDataUnsafe?.user?.id || '';
  const emailGoogle = state.empleado?.emailGoogle || '';
  const isWrite = ['fichar','corregirFichaje','guardarEmpleado','guardarUbicacion',
                   'resolverIncidencia','guardarConfig','loginGoogle'].includes(action);
  const payload = { action, telegramId, emailGoogle, ...data };
  let res;
  if (isWrite) {
    res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
  } else {
    res = await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams(payload), { method: 'GET', redirect: 'follow' });
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── BOTONES ───────────────────────────────────────────────────────
function bloquearBtn(id)   { const el = document.getElementById(id); if (el) { el.disabled = true;  el.style.opacity = '0.55'; } }
function desbloquearBtn(id){ const el = document.getElementById(id); if (el) { el.disabled = false; el.style.opacity = ''; } }

// ── ARRANQUE ──────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  try {
    if (tg) { tg.ready(); tg.expand(); } // setHeaderColor/setBackgroundColor eliminados (warnings v6)

    // ⚡ ARRANQUE INSTANTÁNEO — mostrar UI con cache inmediatamente
    const cachedEmp  = cacheGet('fichajes_emp');
    const cachedUbic = cacheGet('fichajes_ubic', 30*60*1000);
    const cachedCfg  = cacheGet('fichajes_cfg',  30*60*1000);
    // Estado del día NUNCA desde cache — siempre fresco del servidor
    // para garantizar que fichajesHoy y el rosco estén correctos

    if (cachedEmp) {
      state.empleado    = cachedEmp;
      state.ubicaciones = cachedUbic || [];
      state.config      = cachedCfg  || {};
      state.estadoHoy   = null; // forzar refresh siempre
      montarUI();                   // UI instantánea con datos del cache
      refrescarEnSegundoPlano();    // servidor en paralelo, sin bloquear
      return;
    }

    // Primera vez (sin cache): flujo normal
    if (tg?.initDataUnsafe?.user?.id) { await arrancarApp(); return; }
    mostrarLoginGoogle();
  } catch (err) { console.error(err); mostrarErrorInicio(err.message); }
});

// Refresca datos del servidor sin bloquear la UI
async function refrescarEnSegundoPlano() {
  try {
    const telegramId  = tg?.initDataUnsafe?.user?.id || '';
    const emailGoogle = state.empleado?.emailGoogle || '';
    const res  = await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ action:'init', telegramId, emailGoogle }), { redirect:'follow' });
    const init = await res.json();
    if (init.error) return;

    state.empleado    = { ...state.empleado, ...init.empleado };
    state.ubicaciones = init.ubicaciones || state.ubicaciones;
    state.config      = init.config      || state.config;
    state.estadoHoy   = init.estado;

    cacheSet('fichajes_emp',    state.empleado);
    cacheSet('fichajes_ubic',   state.ubicaciones);
    cacheSet('fichajes_cfg',    state.config);
    // estado no se cachea — siempre fresco del servidor

    // Actualizar UI con datos frescos del servidor
    actualizarUIEmpleado(state.empleado);
    actualizarUIFichaje();
    iniciarAnillo();
    if (state.empleado.Rol?.toLowerCase() === 'admin')
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  } catch (e) { /* silencioso, no romper UI */ }
}

// ── LOGIN GOOGLE ──────────────────────────────────────────────────
function mostrarLoginGoogle() {
  ocultarPantallas();
  document.getElementById('screen-login')?.classList.add('active');
  const t = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(t);
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLogin });
      google.accounts.id.renderButton(document.getElementById('google-btn'),
        { theme:'filled_blue', size:'large', text:'signin_with', locale:'es', width:280 });
    }
  }, 150);
}

async function handleGoogleLogin(response) {
  const statusEl = document.getElementById('login-status');
  if (statusEl) { statusEl.textContent = 'Verificando...'; statusEl.className = 'login-status'; }
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', body: JSON.stringify({ action:'loginGoogle', token:response.credential, email:payload.email })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'No autorizado');
    state.empleado = { ...data.empleado, emailGoogle: payload.email };
    cacheSet('fichajes_emp', state.empleado);
    await arrancarApp(true);
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.className = 'login-status error'; }
  }
}

// ── ARRANCAR APP (primera vez, sin cache) ─────────────────────────
async function arrancarApp(yaAutenticado = false) {
  try {
    const telegramId  = tg?.initDataUnsafe?.user?.id || '';
    const emailGoogle = state.empleado?.emailGoogle || '';
    const res  = await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ action:'init', telegramId, emailGoogle }), { redirect:'follow' });
    const init = await res.json();
    if (init.error) throw new Error(init.error);

    state.empleado    = yaAutenticado ? { ...state.empleado, ...init.empleado } : init.empleado;
    state.ubicaciones = init.ubicaciones || [];
    state.config      = init.config      || {};
    state.estadoHoy   = init.estado;

    cacheSet('fichajes_emp',    state.empleado);
    cacheSet('fichajes_ubic',   state.ubicaciones);
    cacheSet('fichajes_cfg',    state.config);
    // estado no se cachea — siempre fresco del servidor
  } catch (err) {
    if (!state.empleado) throw err;
    state.estadoHoy = await api('getEstado');
  }
  montarUI();
}

// Monta la UI con lo que hay en state (cache o servidor)
function montarUI() {
  const emp = state.empleado; if (!emp) return;
  actualizarUIEmpleado(emp);

  const locParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('loc') || '';
  if (locParam) {
    state.ubicacion = state.ubicaciones.find(u => u.NFC_Param===locParam || u.ID_Ubicacion===locParam) || null;
    const subEl = document.getElementById('fichar-ubicacion');
    if (state.ubicacion && subEl) subEl.textContent = '📍 ' + state.ubicacion.Nombre;
  }

  actualizarUIFichaje();
  iniciarAnillo();

  ocultarPantallas();
  document.getElementById('screen-fichar')?.classList.add('active');
  setupOnce();
  iniciarReloj();
  setupNavegacion();

  if (emp.Rol?.toLowerCase() === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  const btnAlarma = document.getElementById('btn-alarma');
  if (btnAlarma) { isIOS ? btnAlarma.classList.add('hidden') : btnAlarma.classList.remove('hidden'); }
}

// ── SETUP EVENTOS ─────────────────────────────────────────────────
function setupOnce() {
  if (window.__fichajesSetupDone) return;
  window.__fichajesSetupDone = true;

  document.getElementById('btn-fichar')?.addEventListener('click', () => prepararFichaje(false));
  document.getElementById('btn-alarma')?.addEventListener('click', iniciarTimerDescanso);
  document.getElementById('btn-manual')?.addEventListener('click', abrirFichajeManual);

  document.getElementById('modal-cancel')?.addEventListener('click', () =>
    document.getElementById('modal-confirmar')?.classList.add('hidden'));

  document.getElementById('modal-confirm')?.addEventListener('click', () => {
    bloquearBtn('modal-confirm'); bloquearBtn('modal-cancel');
    ejecutarFichaje({ comentario: document.getElementById('modal-comentario')?.value?.trim() || '' });
    // Los botones se desbloquean en ejecutarFichaje (fire-and-forget)
    setTimeout(() => { desbloquearBtn('modal-confirm'); desbloquearBtn('modal-cancel'); }, 800);
  });

  document.getElementById('manual-cancel')?.addEventListener('click', () =>
    document.getElementById('modal-manual')?.classList.add('hidden'));
  document.getElementById('manual-confirm')?.addEventListener('click', async () => {
    bloquearBtn('manual-confirm');
    await enviarFichajeManual();
    desbloquearBtn('manual-confirm');
  });

  document.getElementById('btn-volver-fichar')?.addEventListener('click', () => {
    clearInterval(state.timerInterval);
    document.getElementById('modal-alarma')?.classList.add('hidden');
    prepararFichaje(false);
  });
  document.getElementById('btn-cancelar-timer')?.addEventListener('click', () => {
    clearInterval(state.timerInterval);
    document.getElementById('modal-alarma')?.classList.add('hidden');
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', cerrarSidebar);
  document.getElementById('btn-menu')?.addEventListener('click', abrirSidebar);
}

// ── NAVEGACIÓN ────────────────────────────────────────────────────
function setupNavegacion() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => { mostrarPantalla(btn.dataset.view); cerrarSidebar(); });
  });
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => mostrarPantalla(btn.dataset.back));
  });
}

function mostrarPantalla(view) {
  ocultarPantallas();
  document.getElementById('screen-' + view)?.classList.add('active');
  if (view === 'fichar' || view === 'empleados') {
    state._adminVerEmp = null;
    const h = document.querySelector('#screen-mis-fichajes h2');
    if (h) h.textContent = 'Mis Fichajes';
  }
  // Al volver a fichar, refrescar estado en segundo plano por si hubo fichaje NFC
  if (view === 'fichar') {
    api('getEstado').then(estado => {
      state.estadoHoy = estado;
      actualizarUIFichaje();
      iniciarAnillo();
    }).catch(() => {});
  }
  if (view === 'mis-fichajes') cargarMisFichajes();
  if (view === 'dashboard')    cargarDashboard();
  if (view === 'empleados')    cargarEmpleados();
  if (view === 'ubicaciones')  cargarUbicaciones();
  if (view === 'incidencias')  cargarIncidencias();
}

function abrirSidebar()  { document.getElementById('sidebar')?.classList.remove('hidden'); document.getElementById('sidebar-overlay')?.classList.remove('hidden'); }
function cerrarSidebar() { document.getElementById('sidebar')?.classList.add('hidden');    document.getElementById('sidebar-overlay')?.classList.add('hidden'); }

// ── UI EMPLEADO ───────────────────────────────────────────────────
function actualizarUIEmpleado(emp) {
  const ini = (emp.Nombre_Completo||'').split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase();
  ['fichar-avatar','sidebar-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ini; });
  ['fichar-nombre','sidebar-name'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = emp.Nombre_Completo||''; });
  const role = document.getElementById('sidebar-role'); if (role) role.textContent = emp.Rol||'';
}

// ── ESTADO ────────────────────────────────────────────────────────
async function refreshEstado() {
  state.estadoHoy = await api('getEstado');
  actualizarUIFichaje();
  iniciarAnillo();
}

function actualizarUIFichaje() {
  const s = state.estadoHoy; if (!s) return;
  const badge = document.getElementById('tipo-badge');
  if (badge) { badge.textContent = s.proximoTipo||'ENTRADA'; badge.className = 'tipo-badge' + (s.proximoTipo==='SALIDA'?' salida':''); }
  const count = document.getElementById('fichar-count');
  if (count) count.textContent = (s.totalFichajesHoy||0) + ' fichaje' + ((s.totalFichajesHoy||0)===1?'':'s') + ' hoy';
  const btn = document.getElementById('btn-fichar');
  if (btn) btn.className = 'btn btn-fichar' + (s.proximoTipo==='SALIDA'?' salida':'');
  const btnText = document.getElementById('btn-fichar-text');
  if (btnText) btnText.textContent = 'Registrar ' + (s.proximoTipo||'ENTRADA');
}

// ── ANILLO DINÁMICO ───────────────────────────────────────────────
function iniciarAnillo() {
  clearInterval(state.ringInterval);
  actualizarAnillo(); // dibujar anillo inmediatamente

  const s = state.estadoHoy;
  const enCurso = s && s.proximoTipo === 'SALIDA';

  if (enCurso) {
    // Contador de texto cada segundo (liviano)
    // Anillo SVG cada 10 segundos (más pesado visualmente)
    state.ringInterval = setInterval(() => {
      actualizarContador();
      // cada 10 ticks también actualiza el anillo completo
      state._ringTick = (state._ringTick || 0) + 1;
      if (state._ringTick % 10 === 0) actualizarAnillo();
    }, 1000);
  }
}

function actualizarContador() {
  const s      = state.estadoHoy;
  const emp    = state.empleado;
  if (!emp) return;
  const fichajes = (s && s.fichajesHoy) ? s.fichajesHoy : [];
  const minsReal = calcularMinsAcumulados(fichajes);
  const enCurso  = s && s.proximoTipo === 'SALIDA';
  const valorEl  = document.getElementById('trabajado-valor');
  const estadoEl = document.getElementById('trabajado-estado');
  if (valorEl) valorEl.textContent = minsReal > 0 ? formatMins(minsReal) : '—';
  // ▶ si está fichado dentro, ⏸ si está fuera (descanso o fin)
  if (estadoEl) estadoEl.textContent = enCurso ? '▶' : (minsReal > 0 ? '⏸' : '');
}

function actualizarAnillo() {
  const s   = state.estadoHoy;
  const emp = state.empleado;
  if (!emp) return;

  const jornadaBase = parseFloat(emp.Jornada_Base_Dia) > 0 ? parseFloat(emp.Jornada_Base_Dia) : 6.5;
  const objetivo    = parseFloat(emp.Objetivo_Dia)     > 0 ? parseFloat(emp.Objetivo_Dia)     : 7.5;
  const minsBase    = jornadaBase * 60;

  const fichajes     = (s && s.fichajesHoy) ? s.fichajesHoy : [];
  const minsReal     = calcularMinsAcumulados(fichajes);
  const minsDescanso = calcularMinsDescanso(fichajes);
  const enCurso      = s && s.proximoTipo === 'SALIDA';

  // Contador en vivo
  const valorEl  = document.getElementById('trabajado-valor');
  const estadoEl = document.getElementById('trabajado-estado');
  if (valorEl)  valorEl.textContent  = minsReal > 0 ? formatMins(minsReal) : '—';
  if (estadoEl) estadoEl.textContent = enCurso ? '▶' : (minsReal > 0 ? '⏸' : '');

  const wrap = document.querySelector('.ring-wrap');
  if (wrap) { enCurso ? wrap.classList.add('fichado') : wrap.classList.remove('fichado'); }

  // Total del anillo = trabajo + descanso (mínimo = objetivo)
  const minsTotal = Math.max(objetivo * 60, minsReal + minsDescanso, 1);

  // Construir y dibujar segmentos cronológicos
  const segs = construirSegmentos(fichajes, minsBase, minsTotal, enCurso);
  dibujarSegmentos(segs);

  actualizarLeyenda(jornadaBase, objetivo, minsReal, minsDescanso);
}

// Construye segmentos cronológicos {p1, p2, color}
function construirSegmentos(fichajes, minsBase, minsTotal, enCurso) {
  if (!Array.isArray(fichajes) || !fichajes.length) return [];
  const norm = fichajes.map(f => ({
    Tipo: (f.Tipo || f.tipo || '').toUpperCase(),
    Hora: (f.Hora || f.hora || '').slice(0, 5)
  })).filter(f => f.Hora).sort((a, b) => a.Hora.localeCompare(b.Hora));

  const segs = [];
  let cursor = 0;      // posición actual en el anillo (minutos)
  let trabajado = 0;   // minutos de trabajo acumulados

  for (let i = 0; i < norm.length; i++) {
    const cur  = norm[i];
    const next = norm[i + 1];

    if (cur.Tipo === 'ENTRADA') {
      // Fin de este tramo de trabajo
      const horaFin = next && next.Tipo === 'SALIDA' ? next.Hora
                    : (enCurso ? horaActual() : null);
      if (!horaFin) continue;
      const dur = Math.max(0, toMins(horaFin) - toMins(cur.Hora));
      if (dur <= 0) continue;

      // Dividir en azul/verde si cruza la frontera de jornada base
      const quedaBase = Math.max(0, minsBase - trabajado);
      const durBase   = Math.min(dur, quedaBase);
      const durBolsa  = dur - durBase;

      if (durBase > 0) {
        segs.push({ p1: cursor / minsTotal, p2: (cursor + durBase) / minsTotal, color: 'base' });
        cursor += durBase;
      }
      if (durBolsa > 0) {
        segs.push({ p1: cursor / minsTotal, p2: (cursor + durBolsa) / minsTotal, color: 'bolsa' });
        cursor += durBolsa;
      }
      trabajado += dur;

    } else if (cur.Tipo === 'SALIDA' && next && next.Tipo === 'ENTRADA') {
      // Tramo de descanso (naranja)
      const durDesc = Math.max(0, toMins(next.Hora) - toMins(cur.Hora));
      if (durDesc > 0) {
        segs.push({ p1: cursor / minsTotal, p2: (cursor + durDesc) / minsTotal, color: 'descanso' });
        cursor += durDesc;
      }
    }
  }
  return segs;
}

// Dibuja los segmentos en el SVG (crea/elimina paths dinámicamente)
function dibujarSegmentos(segs) {
  const svg = document.querySelector('.progress-ring'); if (!svg) return;
  // Limpiar segmentos anteriores
  svg.querySelectorAll('.ring-seg').forEach(el => el.remove());
  // Colores por tipo
  const colores = { base: '#4f8ef7', bolsa: '#2ecc71', descanso: '#f39c12' };
  segs.forEach(seg => {
    const p1 = Math.max(0, seg.p1);
    const p2 = Math.min(0.9999, seg.p2);
    if (p2 - p1 < 0.001) return;
    const cx=110, cy=110, r=96;
    const t1=-Math.PI/2+p1*2*Math.PI, t2=-Math.PI/2+p2*2*Math.PI;
    const x1=cx+r*Math.cos(t1), y1=cy+r*Math.sin(t1);
    const x2=cx+r*Math.cos(t2), y2=cy+r*Math.sin(t2);
    const large=(p2-p1)>0.5?1:0;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.classList.add('ring-seg');
    path.setAttribute('fill','none');
    path.setAttribute('stroke', colores[seg.color] || '#4f8ef7');
    path.setAttribute('stroke-width','8');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('d','M '+x1.toFixed(3)+' '+y1.toFixed(3)+
      ' A '+r+' '+r+' 0 '+large+' 1 '+x2.toFixed(3)+' '+y2.toFixed(3));
    svg.appendChild(path);
  });
}


function actualizarLeyenda(jornadaBase, objetivo, minsReal, minsDescanso) {
  const el = document.getElementById('ring-leyenda'); if (!el) return;
  const minsBase = jornadaBase * 60;

  // Todo lo que pasa de jornada base es bolsa (sin distinción de exceso)
  const minsTramoBase  = Math.min(minsReal, minsBase);
  const minsTramoVerde = Math.max(0, minsReal - minsBase);

  const items = [
    { clase: 'base',  texto: 'Jornada ' + (minsTramoBase > 0 ? formatMins(minsTramoBase) : jornadaBase + 'h obj.') },
    { clase: 'bolsa', texto: 'Bolsa '   + (minsTramoVerde > 0 ? formatMins(minsTramoVerde) : '+' + (objetivo - jornadaBase) + 'h obj.') },
  ];
  if (minsDescanso > 0) items.push({ clase: 'descanso', texto: 'Descanso ' + formatMins(minsDescanso) });

  el.innerHTML = items.map(i =>
    '<div class="ring-leyenda-item ' + i.clase + '">' +
    '<span class="ring-leyenda-dot"></span>' +
    '<span>' + i.texto + '</span></div>'
  ).join('');
}

// Dibuja un arco SVG de p1 a p2 (proporciones 0..1) sin transforms
// Centro (110,110), radio 96, empieza en las 12 en punto
function dibujarArco(id, p1, p2) {
  const el = document.getElementById(id); if (!el) return;
  if (isNaN(p1) || isNaN(p2) || p2 - p1 < 0.001) { el.setAttribute('d', ''); return; }
  // Clamp p2 para evitar arco degenerado (inicio==fin cuando p2=1.0)
  const p2c = Math.min(p2, 0.9999);
  const cx = 110, cy = 110, r = 96;
  const t1 = -Math.PI / 2 + p1  * 2 * Math.PI;
  const t2 = -Math.PI / 2 + p2c * 2 * Math.PI;
  const x1 = cx + r * Math.cos(t1);
  const y1 = cy + r * Math.sin(t1);
  const x2 = cx + r * Math.cos(t2);
  const y2 = cy + r * Math.sin(t2);
  const large = (p2c - p1) > 0.5 ? 1 : 0;
  el.setAttribute('d', 'M ' + x1.toFixed(3) + ' ' + y1.toFixed(3) +
    ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(3) + ' ' + y2.toFixed(3));
}

function calcularMinsDescanso(fichajes) {
  // Suma tiempo entre cada par SALIDA→ENTRADA consecutivo
  if (!Array.isArray(fichajes) || fichajes.length < 2) return 0;
  const norm = fichajes.map(f => ({
    Tipo: (f.Tipo || f.tipo || '').toUpperCase(),
    Hora: (f.Hora || f.hora || '').slice(0, 5)
  }));
  const ord = [...norm].sort((a,b) => (a.Hora||'').localeCompare(b.Hora||''));
  let mins = 0;
  for (let i = 0; i < ord.length - 1; i++) {
    if (ord[i].Tipo === 'SALIDA' && ord[i+1].Tipo === 'ENTRADA') {
      const d = toMins(ord[i+1].Hora) - toMins(ord[i].Hora);
      if (d > 0) mins += d;
    }
  }
  return mins;
}

function calcularMinsAcumulados(fichajes) {
  if (!Array.isArray(fichajes) || !fichajes.length) return 0;
  // Normalizar: aceptar Tipo/tipo y Hora/hora en cualquier combinación
  const norm = fichajes.map(f => ({
    Tipo: (f.Tipo || f.tipo || '').toUpperCase(),
    Hora: (f.Hora || f.hora || '').slice(0, 5)
  }));
  const ord = [...norm].sort((a,b) => (a.Hora||'').localeCompare(b.Hora||''));
  let mins = 0;
  for (let i = 0; i < ord.length - 1; i += 2) {
    if (ord[i].Tipo === 'ENTRADA' && ord[i+1]?.Tipo === 'SALIDA')
      mins += toMins(ord[i+1].Hora) - toMins(ord[i].Hora);
  }
  // Entrada abierta → sumar hasta ahora
  if (ord.length % 2 !== 0 && ord[ord.length-1].Tipo === 'ENTRADA')
    mins += toMins(horaActual()) - toMins(ord[ord.length-1].Hora);
  return Math.max(mins, 0);
}

// ── FICHAJE ───────────────────────────────────────────────────────
async function prepararFichaje(autoConfirm) {
  bloquearBtn('btn-fichar');
  try {
    await refreshEstado();
    const confirmar = state.empleado?.Confirmar_Fichaje !== 'false';
    if (autoConfirm || !confirmar) { await ejecutarFichaje({ comentario:'' }); return; }

    const tipo = state.estadoHoy?.proximoTipo || 'ENTRADA';
    document.getElementById('modal-icon').textContent = tipo==='ENTRADA'?'🟢':'🔴';
    document.getElementById('modal-titulo').textContent = 'Confirmar fichaje';
    document.getElementById('modal-subtitulo').textContent = tipo + ' — ' + horaActual();

    // Mostrar horas acumuladas en modal de SALIDA
    const resumen = document.getElementById('modal-resumen-horas');
    if (tipo === 'SALIDA' && resumen) {
      const mins = calcularMinsAcumulados(state.estadoHoy?.fichajesHoy || []);
      if (mins > 0) {
        resumen.classList.remove('hidden');
        document.getElementById('resumen-valor').textContent = formatMins(mins);
      } else resumen.classList.add('hidden');
    } else if (resumen) resumen.classList.add('hidden');

    document.getElementById('modal-comentario').value = '';
    document.getElementById('modal-confirmar')?.classList.remove('hidden');
  } finally {
    desbloquearBtn('btn-fichar');
  }
}

async function ejecutarFichaje({ comentario }) {
  const tipo = state.estadoHoy?.proximoTipo || 'ENTRADA';

  // ⚡ OPTIMISTIC UI — actualizar pantalla ANTES de esperar el backend
  aplicarFichajeOptimista(tipo);

  // Lanzar al backend en segundo plano
  api('fichar', {
    comentario,
    ubicacionId:     state.ubicacion?.ID_Ubicacion || '',
    ubicacionNombre: state.ubicacion?.Nombre || '',
    metodo: state.ubicacion ? 'NFC' : (tg?.initDataUnsafe?.user?.id ? 'MINI_APP' : 'WEB')
  }).then(res => {
    if (res.ok) {
      toast('✅ ' + res.tipo + ' a las ' + res.hora, 'ok');
      // Refrescar estado real del servidor (silencioso)
      api('getEstado').then(estado => {
        state.estadoHoy = estado;
        actualizarUIFichaje();
        iniciarAnillo();
      }).catch(() => {});
      if (res.tipo === 'SALIDA' && !isIOS) iniciarTimerDescanso();
    }
  }).catch(err => {
    // Si falla, revertir
    toast('❌ Error al fichar: ' + err.message, 'error');
    refreshEstado(); // revertir UI al estado real
  });

  document.getElementById('modal-confirmar')?.classList.add('hidden');
}

function aplicarFichajeOptimista(tipo) {
  // Simular el nuevo fichaje en el estado local sin esperar al servidor
  const s = state.estadoHoy || { totalFichajesHoy:0, fichajesHoy:[], proximoTipo:'ENTRADA' };
  const nuevaHora = horaActual();
  const nuevosFichajes = [...(s.fichajesHoy||[]), { Tipo: tipo, Hora: nuevaHora }];
  const nuevoTotal = (s.totalFichajesHoy||0) + 1;
  state.estadoHoy = {
    ...s,
    totalFichajesHoy: nuevoTotal,
    fichajesHoy:      nuevosFichajes,
    proximoTipo:      tipo === 'ENTRADA' ? 'SALIDA' : 'ENTRADA',
    ultimoTipo:       tipo,
    ultimaHora:       nuevaHora
  };
  actualizarUIFichaje();
  iniciarAnillo();
}

// ── FICHAJE MANUAL ────────────────────────────────────────────────
function abrirFichajeManual() {
  document.getElementById('manual-fecha').value = fechaHoy();
  document.getElementById('manual-hora').value  = horaActual();
  document.getElementById('manual-comentario').value = '';
  document.getElementById('modal-manual')?.classList.remove('hidden');
}

async function enviarFichajeManual() {
  const fecha      = document.getElementById('manual-fecha')?.value;
  const hora       = document.getElementById('manual-hora')?.value;
  const comentario = document.getElementById('manual-comentario')?.value?.trim() || '';
  if (!fecha || !hora) { toast('Indica fecha y hora', 'error'); return; }
  try {
    const res = await api('fichar', { fecha, hora, comentario, ubicacionId:'', ubicacionNombre:'', metodo:'MANUAL' });
    if (res.ok) {
      toast('✅ ' + res.tipo + ' manual registrada', 'ok');
      document.getElementById('modal-manual')?.classList.add('hidden');
      await refreshEstado();
    }
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

// ── TIMER DESCANSO (solo Android) ─────────────────────────────────
function iniciarTimerDescanso() {
  if (isIOS) return;
  const raw  = parseInt(state.empleado?.Alarma_Descanso || state.config?.ALARMA_DESCANSO || '25', 10);
  const mins = isNaN(raw) || raw <= 0 ? 25 : raw;
  state.timerSeconds = mins * 60;
  document.getElementById('modal-alarma')?.classList.remove('hidden');
  clearInterval(state.timerInterval);
  actualizarTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerSeconds--;
    actualizarTimerDisplay();
    if (state.timerSeconds <= 0) { clearInterval(state.timerInterval); toast('⏰ Descanso completado. ¡Hora de volver!','warning'); }
  }, 1000);
}
function actualizarTimerDisplay() {
  const el = document.getElementById('timer-display'); if (!el) return;
  el.textContent = String(Math.floor(state.timerSeconds/60)).padStart(2,'0')+':'+String(state.timerSeconds%60).padStart(2,'0');
}

// ── MIS FICHAJES ──────────────────────────────────────────────────
async function cargarMisFichajes() {
  const input = document.getElementById('filter-mes'); if (!input) return;
  const hoy = new Date();
  if (!input.value) input.value = hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0');
  input.onchange = () => cargarMisFichajes();
  const lista = document.getElementById('lista-fichajes'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  // Admin viendo fichajes de otro empleado
  const params = { mes: input.value };
  if (state._adminVerEmp) params.numEmp = state._adminVerEmp.id;
  try {
    const data = await api('getFichajes', params);
    if (!data.length) { lista.innerHTML='<div class="empty-state">Sin fichajes este mes</div>'; return; }
    const porDia = {};
    data.forEach(f => { if (!porDia[f.Fecha]) porDia[f.Fecha]=[]; porDia[f.Fecha].push(f); });
    lista.innerHTML = Object.keys(porDia).sort().reverse().map(fecha => {
      const fd = porDia[fecha]; const horas = calcularHorasDia(fd);
      const filas = fd.map(f => `
        <div class="fichaje-row">
          <span class="fichaje-tipo-dot">${f.Tipo==='ENTRADA'?'🟢':'🔴'}</span>
          <span class="fichaje-hora">${f.Hora}</span>
          <span class="fichaje-tipo">${f.Tipo}</span>
          <span class="fichaje-ubi">${f.Ubicacion_Nombre||''}</span>
          ${f.Comentario?`<span class="fichaje-nota">💬 ${f.Comentario}</span>`:''}
        </div>`).join('');
      return `<div class="dia-card">
        <div class="dia-header">
          <span class="dia-fecha">${formatearFecha(fecha)}</span>
          ${horas?`<span class="dia-horas">${horas}</span>`:''}
        </div>${filas}</div>`;
    }).join('');
  } catch (err) { lista.innerHTML='<div class="empty-state error">Error: '+err.message+'</div>'; }
}

// ── DASHBOARD ─────────────────────────────────────────────────────
async function cargarDashboard() {
  try {
    const año = new Date().getFullYear();
    const dashAño = document.getElementById('dash-año'); if (dashAño) dashAño.textContent = año;
    const resumen = await api('getResumen', { año });
    const obj  = parseFloat(state.empleado?.Horas_Anuales || 1770);
    const real = resumen.horasRealizadas || 0;
    const pct  = Math.min(100, Math.round((real / obj) * 100));

    // Barra anual
    const barra = document.getElementById('dash-barra-anual'); if (barra) barra.style.width = pct + '%';
    const hReal = document.getElementById('dash-horas-real'); if (hReal) hReal.textContent = real + 'h';
    const hObj  = document.getElementById('dash-horas-obj');  if (hObj)  hObj.textContent  = '/ ' + obj + 'h';
    const dif   = parseFloat((real - obj).toFixed(1));
    const difEl = document.getElementById('dash-diferencial');
    if (difEl) { difEl.textContent = (dif >= 0 ? '+' : '') + dif + 'h'; difEl.className = 'diferencial ' + (dif >= 0 ? 'pos' : 'neg'); }

    // Horas restantes para acabar el año
    const restantes = Math.max(0, obj - real);
    const dashRestantes = document.getElementById('dash-horas-restantes');
    if (dashRestantes) dashRestantes.textContent = restantes > 0 ? 'Faltan ' + restantes.toFixed(1) + 'h para el objetivo anual' : '✅ Objetivo anual superado';

    // Trimestres
    renderTrimestres(resumen.objetivosPorTrimestre || {}, resumen.detalleDias || []);

    // Calendario mes actual
    const mesInput = document.getElementById('dash-mes');
    if (mesInput && !mesInput.value) {
      const hoy = new Date();
      mesInput.value = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0');
    }
    if (mesInput) {
      mesInput.onchange = () => renderCalendario(resumen.detalleDias || [], mesInput.value);
      renderCalendario(resumen.detalleDias || [], mesInput.value);
    }

    // Semana
    if (resumen.semana) renderSemana(resumen.semana);
  } catch(err) { console.error('Dashboard:', err); }
}

function renderTrimestres(objetivos, detalleDias) {
  const grid = document.getElementById('trimestres-grid'); if (!grid) return;
  const mesActual = new Date().getMonth() + 1;
  const trimActual = Math.ceil(mesActual / 3);

  // Calcular horas reales por trimestre desde detalleDias
  const horasPorTrim = { 1: 0, 2: 0, 3: 0, 4: 0 };
  detalleDias.forEach(d => {
    const mes = parseInt((d.fecha || '').split('-')[1] || '0');
    const trim = Math.ceil(mes / 3);
    if (trim >= 1 && trim <= 4) horasPorTrim[trim] += d.horas || 0;
  });

  // Objetivo por defecto si no está configurado: Horas_Anuales / 4
  const horasAnuales = parseFloat(state.empleado?.Horas_Anuales || 1770);
  const objDef = horasAnuales / 4;

  grid.innerHTML = [1, 2, 3, 4].map(q => {
    const objQ  = parseFloat(objetivos['Q' + q] || objDef);
    const realQ = parseFloat(horasPorTrim[q].toFixed(1));
    const pctQ  = Math.min(100, Math.round((realQ / objQ) * 100));
    const esActual = q === trimActual;
    const completado = q < trimActual;
    return `<div class="trim-card ${esActual ? 'activo' : ''} ${completado ? 'completado' : ''}">
      <div class="trim-label">Q${q} ${completado ? '✅' : esActual ? '▶' : ''}</div>
      <div class="trim-horas">${realQ}h</div>
      <div class="trim-obj">/ ${objQ}h objetivo</div>
      <div class="progress-bar-wrap" style="margin-top:8px">
        <div class="progress-bar" style="width:${pctQ}%"></div>
      </div>
    </div>`;
  }).join('');
}

function renderCalendario(detalleDias, mesStr) {
  const grid = document.getElementById('calendario-grid'); if (!grid) return;
  if (!mesStr) return;

  const [año, mes] = mesStr.split('-').map(Number);
  const hoy = new Date();
  const esHoy = (d) => d === hoy.getDate() && mes === hoy.getMonth()+1 && año === hoy.getFullYear();

  const jornadaBase = parseFloat(state.empleado?.Jornada_Base_Dia || 6.5);
  const minsBase = jornadaBase * 60;

  // Mapa por fecha usando minutos directamente del backend
  const datosPorDia = {};
  detalleDias.forEach(d => {
    datosPorDia[d.fecha] = {
      mins:     parseInt(d.minutos || 0, 10),
      descanso: parseInt(d.minsDescanso || 0, 10)
    };
  });

  const primerDia = new Date(año, mes-1, 1).getDay();
  const primerLunes = primerDia === 0 ? 6 : primerDia - 1;
  const diasEnMes = new Date(año, mes, 0).getDate();

  const headers = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'].map(d =>
    `<div class="cal-day-header">${d}</div>`).join('');

  const vacios = Array(primerLunes).fill('<div class="cal-day vacio"><span class="cal-num"></span></div>').join('');

  const dias = Array.from({length: diasEnMes}, (_, i) => {
    const d = i + 1;
    const fechaStr = año + '-' + String(mes).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const datos = datosPorDia[fechaStr];
    const mins = datos?.mins || 0;
    const descanso = datos?.descanso || 0;

    let clase = 'cal-day';
    if (esHoy(d)) clase += ' hoy';

    let dots = '';
    if (mins > 0) {
      const minsJornada = Math.min(mins, minsBase);
      const minsBolsa   = Math.max(0, mins - minsBase);
      dots = '<div class="cal-dots">';
      dots += `<div class="cal-dot base"><div class="cal-dot-circle"></div><span>${formatMins(minsJornada)}</span></div>`;
      if (minsBolsa > 0) dots += `<div class="cal-dot bolsa"><div class="cal-dot-circle"></div><span>${formatMins(minsBolsa)}</span></div>`;
      if (descanso > 0)  dots += `<div class="cal-dot descanso"><div class="cal-dot-circle"></div><span>${formatMins(descanso)}</span></div>`;
      dots += '</div>';
    }

    return `<div class="${clase}"><span class="cal-num">${d}</span>${dots}</div>`;
  }).join('');

  grid.innerHTML = headers + vacios + dias;
}

function renderSemana(dias) {
  const cont = document.getElementById('semana-bars'); if (!cont) return;
  const names = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
  const max = Math.max(...dias.map(d=>d.minutos||0),1);
  cont.innerHTML = dias.map((d,i) => `
    <div class="semana-col">
      <div class="semana-bar-wrap"><div class="semana-bar" style="height:${Math.round(((d.minutos||0)/max)*100)}%"></div></div>
      <div class="semana-label">${names[i]}</div>
      <div class="semana-h">${d.minutos?Math.floor(d.minutos/60)+'h':''}</div>
    </div>`).join('');
}

// ── ADMIN: EMPLEADOS ──────────────────────────────────────────────
async function cargarEmpleados() {
  const lista = document.getElementById('lista-empleados'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    state.empleados = await api('getEmpleados');
    if (!state.empleados.length) { lista.innerHTML='<div class="empty-state">Sin empleados</div>'; return; }
    lista.innerHTML = state.empleados.map(emp => {
      const ini  = (emp.Nombre_Completo||'').split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase();
      const activo = emp.Activo?.toString() === 'true';
      const esAdmin = emp.Rol?.toLowerCase() === 'admin';
      return `<div class="admin-card ${activo?'':'emp-inactivo'}" id="emp-card-${emp.ID_Empleado}">
        <div class="admin-card-info">
          <span class="avatar sm ${activo?'':'avatar-inactivo'}">${ini}</span>
          <div>
            <div class="admin-card-name">
              ${emp.Nombre_Completo}
              <span class="badge-rol ${esAdmin?'admin':''}">${emp.Rol||'empleado'}</span>
              ${!activo?'<span class="badge-inactivo">Inactivo</span>':''}
            </div>
            <div class="admin-card-sub">${emp.Email||''}</div>
            <div class="admin-card-sub">${emp.Telegram_ID?'TG: '+emp.Telegram_ID:''}</div>
          </div>
        </div>
        <div class="emp-acciones">
          <button class="btn btn-sm btn-ghost" title="Ver fichajes" onclick="verFichajesEmpleado('${emp.ID_Empleado}','${emp.Nombre_Completo}')">📋</button>
          <button class="btn btn-sm btn-ghost" title="Editar" onclick="editarEmpleado('${emp.ID_Empleado}')">✏️</button>
          <button class="btn btn-sm ${activo?'btn-ghost':'btn-primary'}" title="${activo?'Desactivar':'Activar'}"
            onclick="toggleActivoEmpleado('${emp.ID_Empleado}',${activo})">${activo?'🔴':'🟢'}</button>
        </div>
      </div>`;
    }).join('');
    const btnNuevo = document.getElementById('btn-nuevo-empleado');
    if (btnNuevo) btnNuevo.onclick = () => abrirFormEmpleado(null);
  } catch(err) { lista.innerHTML='<div class="empty-state error">'+err.message+'</div>'; }
}

async function toggleActivoEmpleado(id, estaActivo) {
  const emp = state.empleados.find(e => e.ID_Empleado === id); if (!emp) return;
  const nuevoEstado = !estaActivo;
  if (!confirm((nuevoEstado ? '¿Activar' : '¿Desactivar') + ' a ' + emp.Nombre_Completo + '?')) return;
  try {
    await api('guardarEmpleado', {
      id, nombre: emp.Nombre_Completo, numero: emp.Numero_Empleado,
      email: emp.Email, empTelegramId: emp.Telegram_ID, rol: emp.Rol,
      notificaciones: emp.Notificaciones, horasAnuales: emp.Horas_Anuales,
      jornadaBase: emp.Jornada_Base_Dia, objetivoDia: emp.Objetivo_Dia,
      alarmaDescanso: emp.Alarma_Descanso, confirmarFichaje: emp.Confirmar_Fichaje,
      Q1: emp.Q1, Q2: emp.Q2, Q3: emp.Q3, Q4: emp.Q4, activo: nuevoEstado.toString()
    });
    toast((nuevoEstado ? '✅ Empleado activado' : '⏸ Empleado desactivado'), 'ok');
    await cargarEmpleados();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

function verFichajesEmpleado(id, nombre) {
  // Buscar Numero_Empleado (el que usa el backend para filtrar)
  const emp = state.empleados.find(e => e.ID_Empleado === id);
  const numEmp = emp?.Numero_Empleado || id;
  state._adminVerEmp = { id: numEmp, nombre };
  mostrarPantalla('mis-fichajes');
  const header = document.querySelector('#screen-mis-fichajes h2');
  if (header) header.textContent = 'Fichajes — ' + nombre;
}

function abrirFormEmpleado(emp) {
  document.getElementById('emp-form-titulo').textContent = emp ? 'Editar Empleado' : 'Nuevo Empleado';
  document.getElementById('emp-id').value          = emp?.ID_Empleado       || '';
  document.getElementById('emp-nombre').value      = emp?.Nombre_Completo   || '';
  document.getElementById('emp-numero').value      = emp?.Numero_Empleado   || '';
  document.getElementById('emp-email').value       = emp?.Email             || '';
  document.getElementById('emp-tgid').value        = emp?.Telegram_ID       || '';
  document.getElementById('emp-rol').value         = emp?.Rol               || 'empleado';
  document.getElementById('emp-notif').value       = emp?.Notificaciones    || 'privado';
  document.getElementById('emp-horas').value       = emp?.Horas_Anuales     || '1770';
  document.getElementById('emp-jornada-base').value= emp?.Jornada_Base_Dia  || '6.5';
  document.getElementById('emp-objetivo-dia').value= emp?.Objetivo_Dia      || '7.5';
  document.getElementById('emp-alarma').value      = emp?.Alarma_Descanso   || '25';
  document.getElementById('emp-q1').value          = emp?.Q1                || '';
  document.getElementById('emp-q2').value          = emp?.Q2                || '';
  document.getElementById('emp-q3').value          = emp?.Q3                || '';
  document.getElementById('emp-q4').value          = emp?.Q4                || '';
  document.getElementById('emp-confirmar').value   = emp?.Confirmar_Fichaje || 'true';
  document.getElementById('modal-empleado')?.classList.remove('hidden');
  document.getElementById('emp-cancel').onclick = () => document.getElementById('modal-empleado')?.classList.add('hidden');
  document.getElementById('emp-save').onclick   = guardarEmpleadoForm;
}

function editarEmpleado(id) {
  const emp = state.empleados.find(e => e.ID_Empleado===id);
  if (emp) abrirFormEmpleado(emp);
}

async function guardarEmpleadoForm() {
  try {
    const empId = document.getElementById('emp-id').value;
    const empActual = state.empleados.find(e => e.ID_Empleado === empId);
    await api('guardarEmpleado', {
      id:               empId,
      nombre:           document.getElementById('emp-nombre').value,
      numero:           document.getElementById('emp-numero').value,
      email:            document.getElementById('emp-email').value,
      empTelegramId:    document.getElementById('emp-tgid').value,
      rol:              document.getElementById('emp-rol').value,
      notificaciones:   document.getElementById('emp-notif').value,
      horasAnuales:     document.getElementById('emp-horas').value,
      jornadaBase:      document.getElementById('emp-jornada-base').value,
      objetivoDia:      document.getElementById('emp-objetivo-dia').value,
      alarmaDescanso:   document.getElementById('emp-alarma').value,
      confirmarFichaje: document.getElementById('emp-confirmar').value,
      Q1:               document.getElementById('emp-q1').value,
      Q2:               document.getElementById('emp-q2').value,
      Q3:               document.getElementById('emp-q3').value,
      Q4:               document.getElementById('emp-q4').value,
      activo:           empActual ? empActual.Activo : 'true',
    });
    toast('✅ Empleado guardado','ok');
    document.getElementById('modal-empleado')?.classList.add('hidden');
    await cargarEmpleados();
  } catch(err) { toast('❌ '+err.message,'error'); }
}

// ── ADMIN: UBICACIONES ────────────────────────────────────────────
async function cargarUbicaciones() {
  const lista = document.getElementById('lista-ubicaciones'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    // Cargar empleados si no están cargados (para los enlaces NFC)
    if (!state.empleados || !state.empleados.length) {
      try { state.empleados = await api('getEmpleados'); } catch(e) {}
    }
    state.ubicaciones = await api('getUbicaciones');
    // URL de Telegram para NFC — abre el bot y ficha directamente sin abrir la web
    const nfcBase = APPS_SCRIPT_URL + '?action=ficharNFC&loc=';
    const empsActivos = (state.empleados && state.empleados.length)
      ? state.empleados.filter(e => e.Activo?.toString().toLowerCase() === 'true')
      : [];

    lista.innerHTML = state.ubicaciones.map(u => {
      const nfc = u.NFC_Param || u.ID_Ubicacion;
      // Generar enlaces NFC por empleado
      const enlacesEmp = empsActivos.map(emp => {
        const url = nfcBase + encodeURIComponent(nfc) + '&tgId=' + emp.Telegram_ID;
        return `<div class="ubi-emp-row">
          <span class="ubi-emp-nombre">${emp.Nombre_Completo}</span>
          <div class="ubi-url-wrap">
            <span class="ubi-url" title="${url}">${url}</span>
            <button class="btn-copy" onclick="copiarUrl('${url}')" title="Copiar">📋</button>
          </div>
        </div>`;
      }).join('');

      return `<div class="admin-card ubi-card" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${empsActivos.length?'10px':'0'}">
          <span style="font-size:18px">📍</span>
          <div style="flex:1">
            <div class="admin-card-name">${u.Nombre}</div>
            ${u.Descripcion?`<div class="admin-card-sub">${u.Descripcion}</div>`:''}
          </div>
          <button class="btn btn-sm btn-ghost" onclick="editarUbicacion('${u.ID_Ubicacion}')">✏️</button>
        </div>
        ${enlacesEmp ? `<div class="ubi-empleados">${enlacesEmp}</div>` : ''}
      </div>`;
    }).join('') || '<div class="empty-state">Sin ubicaciones</div>';
    const btnNueva = document.getElementById('btn-nueva-ubicacion');
    if (btnNueva) btnNueva.onclick = () => abrirFormUbicacion(null);
  } catch(err) { lista.innerHTML='<div class="empty-state error">'+err.message+'</div>'; }
}

function copiarUrl(url) {
  navigator.clipboard.writeText(url)
    .then(() => toast('✅ Enlace copiado', 'ok'))
    .catch(() => {
      // Fallback para Telegram que puede bloquear clipboard
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('✅ Enlace copiado', 'ok');
    });
}

function abrirFormUbicacion(ubi) {
  // Reutilizar modal genérico o crear uno inline
  const nombre     = ubi ? ubi.Nombre      : '';
  const descripcion= ubi ? ubi.Descripcion : '';
  const nfcParam   = ubi ? ubi.NFC_Param   : '';
  const id         = ubi ? ubi.ID_Ubicacion: '';

  const html = `<div class="modal-overlay" id="modal-ubicacion" style="display:flex">
    <div class="modal-card">
      <h3>${ubi ? 'Editar Ubicación' : 'Nueva Ubicación'}</h3>
      <label class="field-label mt">Nombre</label>
      <input type="text" id="ubi-nombre" class="select-field" value="${nombre}" placeholder="Oficina Central"/>
      <label class="field-label mt">Descripción</label>
      <input type="text" id="ubi-descripcion" class="select-field" value="${descripcion}" placeholder="Descripción opcional"/>
      <label class="field-label mt">Parámetro NFC (se genera automático si se deja vacío)</label>
      <input type="text" id="ubi-nfc" class="select-field" value="${nfcParam}" placeholder="ej: UBI-OFICINA"/>
      <input type="hidden" id="ubi-id" value="${id}"/>
      <div class="modal-btns mt">
        <button class="btn btn-ghost" onclick="document.getElementById('modal-ubicacion').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="guardarUbicacionForm()">Guardar</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function editarUbicacion(id) {
  const ubi = state.ubicaciones.find(u => u.ID_Ubicacion === id);
  if (ubi) abrirFormUbicacion(ubi);
}

async function guardarUbicacionForm() {
  const id     = document.getElementById('ubi-id')?.value;
  const nombre = document.getElementById('ubi-nombre')?.value?.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  try {
    await api('guardarUbicacion', {
      id:          id || '',
      nombre:      nombre,
      descripcion: document.getElementById('ubi-descripcion')?.value?.trim() || '',
      nfcParam:    document.getElementById('ubi-nfc')?.value?.trim() || '',
      activo:      'true'
    });
    toast('✅ Ubicación guardada', 'ok');
    document.getElementById('modal-ubicacion')?.remove();
    await cargarUbicaciones();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

// ── INCIDENCIAS ───────────────────────────────────────────────────
async function cargarIncidencias() {
  const lista = document.getElementById('lista-incidencias'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    const data = await api('getIncidencias');
    if (!data.length) { lista.innerHTML='<div class="empty-state">Sin incidencias</div>'; return; }
    // Pendientes primero, luego resueltas
    const sorted = [...data].sort((a,b) => {
      if (a.Estado === b.Estado) return (b.Fecha||'').localeCompare(a.Fecha||'');
      return a.Estado === 'PENDIENTE' ? -1 : 1;
    });
    lista.innerHTML = sorted.map(inc => {
      const resuelta = inc.Estado?.toUpperCase() === 'RESUELTA';
      return `<div class="admin-card ${resuelta?'inc-resuelta':''}">
        <div class="admin-card-info">
          <span style="font-size:18px">${resuelta?'✅':'⚠️'}</span>
          <div>
            <div class="admin-card-name">${inc.Empleado_Nombre||''} — ${inc.Fecha}</div>
            <div class="admin-card-sub">${inc.Descripcion}</div>
            ${resuelta?'<div class="admin-card-sub">Resuelta por: '+inc.Resuelta_Por+'</div>':''}
          </div>
        </div>
        ${!resuelta?`<button class="btn btn-sm btn-primary" onclick="resolverIncidencia('${inc.ID}')">Resolver</button>`
          :'<span class="badge ok">Resuelta</span>'}
      </div>`;
    }).join('');
  } catch(err) { lista.innerHTML='<div class="empty-state error">'+err.message+'</div>'; }
}

async function resolverIncidencia(id) {
  if (!confirm('¿Marcar esta incidencia como resuelta?')) return;
  try {
    await api('resolverIncidencia', { id });
    toast('✅ Incidencia resuelta', 'ok');
    await cargarIncidencias();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

// ── UTILIDADES ────────────────────────────────────────────────────
function ocultarPantallas() { document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active')); }
function mostrarErrorInicio(msg) {
  ocultarPantallas(); document.getElementById('screen-login')?.classList.add('active');
  const s = document.getElementById('login-status');
  if (s) { s.textContent=msg; s.className='login-status error'; }
}
function toast(msg,tipo='ok') {
  const el=document.getElementById('toast'); if (!el) return;
  el.textContent=msg; el.className='toast show '+tipo;
  setTimeout(()=>el.className='toast hidden',2800);
}
function sleep(ms)      { return new Promise(r=>setTimeout(r,ms)); }
function horaActual()   { const n=new Date(); return String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0'); }
function fechaHoy()     { const n=new Date(); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); }
function toMins(h)      { if (!h) return 0; const p=h.split(':').map(Number); return p[0]*60+(p[1]||0); }
function formatMins(m)  { return Math.floor(m/60)+'h'+(m%60?' '+m%60+'m':''); }
function formatearFecha(str) {
  if (!str) return ''; const [y,m,d]=str.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'});
}
function calcularHorasDia(fichajes) {
  if (!Array.isArray(fichajes)||fichajes.length<2) return null;
  const ord=[...fichajes].sort((a,b)=>(a.Hora||'').localeCompare(b.Hora||''));
  let mins=0;
  for (let i=0;i<ord.length-1;i+=2) {
    if (ord[i].Tipo==='ENTRADA'&&ord[i+1]?.Tipo==='SALIDA') mins+=toMins(ord[i+1].Hora)-toMins(ord[i].Hora);
  }
  return mins>0?formatMins(mins):null;
}
function iniciarReloj() {
  const tick=()=>{
    const now=new Date();
    const t=document.getElementById('clock-time');
    if (t) t.textContent=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const d=document.getElementById('clock-date');
    if (d) d.textContent=now.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  };
  tick(); clearInterval(window.__clockInt); window.__clockInt=setInterval(tick,1000);
}

window.api = api;
