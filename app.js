// FICHAJES v0.5.3 — app.js
const GOOGLE_CLIENT_ID = '920497100034-08on4kifjrp7l80doe6ucs49ahop5v8c.apps.googleusercontent.com';
const tg = window.Telegram?.WebApp;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const state = { empleado:null, ubicacion:null, estadoHoy:null, timerInterval:null, timerSeconds:0, empleados:[], ubicaciones:[], config:{} };

// ── API ───────────────────────────────────────────────────────────
async function api(action, data = {}) {
  const telegramId = tg?.initDataUnsafe?.user?.id || '';
  const emailGoogle = state.empleado?.emailGoogle || '';
  const isWrite = ['fichar','corregirFichaje','guardarEmpleado','guardarUbicacion','resolverIncidencia','guardarConfig','loginGoogle'].includes(action);
  const payload = { action, telegramId, emailGoogle, ...data };
  let res;
  if (isWrite) {
    res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
  } else {
    const params = new URLSearchParams(payload);
    res = await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { method: 'GET', redirect: 'follow' });
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── ARRANQUE ──────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  try {
    if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d0d1a'); tg.setBackgroundColor('#0d0d1a'); }
    await sleep(700);
    if (tg?.initDataUnsafe?.user?.id) {
      await arrancarApp();
      return;
    }
    const saved = localStorage.getItem('fichajes_emp');
    if (saved) {
      try {
        state.empleado = JSON.parse(saved);
        await arrancarApp(true);
        return;
      } catch (e) {
        localStorage.removeItem('fichajes_emp');
      }
    }
    mostrarLoginGoogle();
  } catch (err) {
    console.error(err);
    mostrarErrorInicio(err.message);
  }
});

// ── LOGIN GOOGLE ──────────────────────────────────────────────────
function mostrarLoginGoogle() {
  ocultarPantallas();
  document.getElementById('screen-login')?.classList.add('active');
  const t = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(t);
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLogin });
      google.accounts.id.renderButton(
        document.getElementById('google-btn'),
        { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'es', width: 280 }
      );
    }
  }, 150);
}

async function handleGoogleLogin(response) {
  const statusEl = document.getElementById('login-status');
  if (statusEl) { statusEl.textContent = 'Verificando...'; statusEl.className = 'login-status'; }
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'loginGoogle', token: response.credential, email: payload.email })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'No autorizado');
    state.empleado = { ...data.empleado, emailGoogle: payload.email };
    localStorage.setItem('fichajes_emp', JSON.stringify(state.empleado));
    await arrancarApp(true);
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.className = 'login-status error'; }
  }
}

// ── ARRANCAR APP ──────────────────────────────────────────────────
async function arrancarApp(yaAutenticado = false) {
  if (!yaAutenticado) {
    state.empleado = await api('getEmpleado');
  }
  const emp = state.empleado;
  const [ubicaciones, config] = await Promise.all([api('getUbicaciones'), api('getConfig')]);
  state.ubicaciones = ubicaciones || [];
  state.config = config || {};
  actualizarUIEmpleado(emp);

  const locParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('loc') || '';
  if (locParam) {
    state.ubicacion = state.ubicaciones.find(u => u.NFC_Param === locParam || u.ID_Ubicacion === locParam) || null;
    const subEl = document.getElementById('fichar-ubicacion');
    if (state.ubicacion && subEl) subEl.textContent = '📍 ' + state.ubicacion.Nombre;
  }

  // Cargar estado ANTES de mostrar pantalla — evita "0 fichajes" al arrancar
  await refreshEstado();

  ocultarPantallas();
  document.getElementById('screen-fichar')?.classList.add('active');
  setupOnce();
  iniciarReloj();
  setupNavegacion();

  if (emp.Rol === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  // Botón alarma: solo Android
  const btnAlarma = document.getElementById('btn-alarma');
  if (btnAlarma) {
    isIOS ? btnAlarma.classList.add('hidden') : btnAlarma.classList.remove('hidden');
  }
}

// ── SETUP EVENTOS ─────────────────────────────────────────────────
function setupOnce() {
  if (window.__fichajesSetupDone) return;
  window.__fichajesSetupDone = true;

  document.getElementById('btn-fichar')?.addEventListener('click', () => prepararFichaje(false));
  document.getElementById('btn-alarma')?.addEventListener('click', iniciarTimerDescanso);
  document.getElementById('btn-manual')?.addEventListener('click', abrirFichajeManual);

  document.getElementById('modal-cancel')?.addEventListener('click', () => document.getElementById('modal-confirmar')?.classList.add('hidden'));
  document.getElementById('modal-confirm')?.addEventListener('click', async () => {
    await ejecutarFichaje({ comentario: document.getElementById('modal-comentario')?.value?.trim() || '' });
  });

  document.getElementById('manual-cancel')?.addEventListener('click', () => document.getElementById('modal-manual')?.classList.add('hidden'));
  document.getElementById('manual-confirm')?.addEventListener('click', enviarFichajeManual);

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
  const el = document.getElementById('screen-' + view);
  if (el) el.classList.add('active');
  if (view === 'mis-fichajes') cargarMisFichajes();
  if (view === 'dashboard')    cargarDashboard();
  if (view === 'empleados')    cargarEmpleados();
  if (view === 'ubicaciones')  cargarUbicaciones();
  if (view === 'incidencias')  cargarIncidencias();
}

function abrirSidebar() {
  document.getElementById('sidebar')?.classList.remove('hidden');
  document.getElementById('sidebar-overlay')?.classList.remove('hidden');
}
function cerrarSidebar() {
  document.getElementById('sidebar')?.classList.add('hidden');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
}

// ── UI EMPLEADO ───────────────────────────────────────────────────
function actualizarUIEmpleado(emp) {
  const ini = (emp.Nombre_Completo || '').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
  ['fichar-avatar', 'sidebar-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ini; });
  ['fichar-nombre', 'sidebar-name'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = emp.Nombre_Completo || ''; });
  const role = document.getElementById('sidebar-role'); if (role) role.textContent = emp.Rol || '';
}

// ── ESTADO ────────────────────────────────────────────────────────
async function refreshEstado() {
  state.estadoHoy = await api('getEstado');
  actualizarUIFichaje();
}

function actualizarUIFichaje() {
  const s = state.estadoHoy; if (!s) return;
  const badge = document.getElementById('tipo-badge');
  if (badge) badge.textContent = s.proximoTipo || 'ENTRADA';
  const count = document.getElementById('fichar-count');
  if (count) count.textContent = (s.totalFichajesHoy || 0) + ' fichaje' + ((s.totalFichajesHoy || 0) === 1 ? '' : 's') + ' hoy';
  const btn = document.getElementById('btn-fichar');
  if (btn) btn.className = 'btn btn-fichar' + (s.proximoTipo === 'SALIDA' ? ' salida' : '');
  const btnText = document.getElementById('btn-fichar-text');
  if (btnText) btnText.textContent = 'Registrar ' + (s.proximoTipo || 'ENTRADA');
}

// ── FICHAJE ───────────────────────────────────────────────────────
async function prepararFichaje(autoConfirm) {
  await refreshEstado();
  const confirmar = state.empleado?.Confirmar_Fichaje !== 'false';
  if (autoConfirm || !confirmar) return ejecutarFichaje({ comentario: '' });

  const tipo = state.estadoHoy?.proximoTipo || 'ENTRADA';
  document.getElementById('modal-icon').textContent = tipo === 'ENTRADA' ? '🟢' : '🔴';
  document.getElementById('modal-titulo').textContent = 'Confirmar fichaje';
  document.getElementById('modal-subtitulo').textContent = tipo + ' — ' + horaActual();

  // Mostrar horas acumuladas del día en cualquier SALIDA
  const resumen = document.getElementById('modal-resumen-horas');
  if (tipo === 'SALIDA' && resumen) {
    const fichajesHoy = state.estadoHoy?.fichajesHoy || [];
    const horasAcum = calcularHorasAcumuladas(fichajesHoy);
    if (horasAcum) {
      resumen.classList.remove('hidden');
      document.getElementById('resumen-valor').textContent = horasAcum;
    } else {
      resumen.classList.add('hidden');
    }
  } else if (resumen) {
    resumen.classList.add('hidden');
  }

  document.getElementById('modal-comentario').value = '';
  document.getElementById('modal-confirmar')?.classList.remove('hidden');
}

async function ejecutarFichaje({ comentario }) {
  try {
    const res = await api('fichar', {
      comentario,
      ubicacionId: state.ubicacion?.ID_Ubicacion || '',
      ubicacionNombre: state.ubicacion?.Nombre || '',
      metodo: state.ubicacion ? 'NFC' : (tg?.initDataUnsafe?.user?.id ? 'MINI_APP' : 'WEB')
    });
    if (res.ok) {
      toast('✅ ' + res.tipo + ' a las ' + res.hora, 'ok');
      document.getElementById('modal-confirmar')?.classList.add('hidden');
      await refreshEstado();
      if (res.tipo === 'SALIDA' && !isIOS) iniciarTimerDescanso();
    }
  } catch (err) {
    toast('❌ ' + err.message, 'error');
  }
}

// ── FICHAJE MANUAL ────────────────────────────────────────────────
function abrirFichajeManual() {
  document.getElementById('manual-fecha').value = fechaHoy();
  document.getElementById('manual-hora').value = horaActual();
  document.getElementById('manual-comentario').value = '';
  document.getElementById('modal-manual')?.classList.remove('hidden');
}

async function enviarFichajeManual() {
  const fecha = document.getElementById('manual-fecha')?.value;
  const hora  = document.getElementById('manual-hora')?.value;
  const comentario = document.getElementById('manual-comentario')?.value?.trim() || '';
  if (!fecha || !hora) { toast('Indica fecha y hora', 'error'); return; }
  try {
    const res = await api('fichar', {
      fecha, hora, comentario,
      ubicacionId: '', ubicacionNombre: '', metodo: 'MANUAL'
    });
    if (res.ok) {
      toast('✅ ' + res.tipo + ' manual registrada', 'ok');
      document.getElementById('modal-manual')?.classList.add('hidden');
      await refreshEstado();
    }
  } catch (err) {
    toast('❌ ' + err.message, 'error');
  }
}

// ── TIMER DESCANSO (solo Android) ─────────────────────────────────
function iniciarTimerDescanso() {
  if (isIOS) return;
  const mins = parseInt(state.empleado?.Alarma_Descanso || state.config?.ALARMA_DESCANSO || '25', 10);
  state.timerSeconds = mins * 60;
  document.getElementById('modal-alarma')?.classList.remove('hidden');
  clearInterval(state.timerInterval);
  actualizarTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerSeconds--;
    actualizarTimerDisplay();
    if (state.timerSeconds <= 0) {
      clearInterval(state.timerInterval);
      toast('⏰ Descanso completado. ¡Hora de volver!', 'warning');
    }
  }, 1000);
}

function actualizarTimerDisplay() {
  const el = document.getElementById('timer-display'); if (!el) return;
  const m = String(Math.floor(state.timerSeconds / 60)).padStart(2, '0');
  const s = String(state.timerSeconds % 60).padStart(2, '0');
  el.textContent = m + ':' + s;
}

// ── MIS FICHAJES ──────────────────────────────────────────────────
async function cargarMisFichajes() {
  const input = document.getElementById('filter-mes');
  if (!input) return;
  const hoy = new Date();
  if (!input.value) input.value = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
  input.onchange = () => cargarMisFichajes();
  const lista = document.getElementById('lista-fichajes');
  if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    const data = await api('getFichajes', { mes: input.value });
    if (!data.length) { lista.innerHTML = '<div class="empty-state">Sin fichajes este mes</div>'; return; }
    const porDia = {};
    data.forEach(f => { if (!porDia[f.Fecha]) porDia[f.Fecha] = []; porDia[f.Fecha].push(f); });
    lista.innerHTML = Object.keys(porDia).sort().reverse().map(fecha => {
      const fichajesDia = porDia[fecha];
      const horas = calcularHorasDia(fichajesDia);
      const filas = fichajesDia.map(f =>
        `<div class="fichaje-row">
          <span class="fichaje-tipo-dot">${f.Tipo === 'ENTRADA' ? '🟢' : '🔴'}</span>
          <span class="fichaje-hora">${f.Hora}</span>
          <span class="fichaje-tipo">${f.Tipo}</span>
          <span class="fichaje-ubi">${f.Ubicacion_Nombre || ''}</span>
          ${f.Comentario ? `<span class="fichaje-nota">💬 ${f.Comentario}</span>` : ''}
        </div>`
      ).join('');
      return `<div class="dia-card">
        <div class="dia-header">
          <span class="dia-fecha">${formatearFecha(fecha)}</span>
          ${horas ? `<span class="dia-horas">${horas}</span>` : ''}
        </div>
        ${filas}
      </div>`;
    }).join('');
  } catch (err) {
    lista.innerHTML = '<div class="empty-state error">Error: ' + err.message + '</div>';
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────
async function cargarDashboard() {
  try {
    const año = new Date().getFullYear();
    const dashAño = document.getElementById('dash-año'); if (dashAño) dashAño.textContent = año;
    const resumen = await api('getResumen', { año });
    const obj  = parseInt(state.empleado?.Horas_Anuales || 1770);
    const real = resumen.horasRealizadas || 0;
    const pct  = Math.min(100, Math.round((real / obj) * 100));
    const barra = document.getElementById('dash-barra-anual'); if (barra) barra.style.width = pct + '%';
    const hReal = document.getElementById('dash-horas-real'); if (hReal) hReal.textContent = real + 'h';
    const hObj  = document.getElementById('dash-horas-obj');  if (hObj)  hObj.textContent  = '/ ' + obj + 'h';
    const dif = real - obj;
    const difEl = document.getElementById('dash-diferencial');
    if (difEl) { difEl.textContent = (dif >= 0 ? '+' : '') + dif + 'h'; difEl.className = 'diferencial ' + (dif >= 0 ? 'pos' : 'neg'); }
    if (resumen.semana) renderSemana(resumen.semana);
  } catch (err) { console.error('Dashboard error:', err); }
}

function renderSemana(dias) {
  const cont = document.getElementById('semana-bars'); if (!cont) return;
  const names = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
  const max = Math.max(...dias.map(d => d.minutos || 0), 1);
  cont.innerHTML = dias.map((d, i) => {
    const pct = Math.round(((d.minutos || 0) / max) * 100);
    return `<div class="semana-col">
      <div class="semana-bar-wrap"><div class="semana-bar" style="height:${pct}%"></div></div>
      <div class="semana-label">${names[i]}</div>
      <div class="semana-h">${d.minutos ? Math.floor(d.minutos / 60) + 'h' : ''}</div>
    </div>`;
  }).join('');
}

// ── ADMIN: EMPLEADOS ──────────────────────────────────────────────
async function cargarEmpleados() {
  const lista = document.getElementById('lista-empleados'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    state.empleados = await api('getEmpleados');
    lista.innerHTML = state.empleados.map(emp => `
      <div class="admin-card">
        <div class="admin-card-info">
          <span class="avatar sm">${(emp.Nombre_Completo||'').split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase()}</span>
          <div>
            <div class="admin-card-name">${emp.Nombre_Completo}</div>
            <div class="admin-card-sub">${emp.Email||''} · ${emp.Rol}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="editarEmpleado('${emp.ID_Empleado}')">✏️</button>
      </div>`).join('') || '<div class="empty-state">Sin empleados</div>';
    document.getElementById('btn-nuevo-empleado')?.addEventListener('click', () => abrirFormEmpleado(null));
  } catch (err) {
    lista.innerHTML = '<div class="empty-state error">' + err.message + '</div>';
  }
}

function abrirFormEmpleado(emp) {
  document.getElementById('emp-form-titulo').textContent = emp ? 'Editar Empleado' : 'Nuevo Empleado';
  document.getElementById('emp-id').value          = emp?.ID_Empleado      || '';
  document.getElementById('emp-nombre').value      = emp?.Nombre_Completo  || '';
  document.getElementById('emp-numero').value      = emp?.Numero_Empleado  || '';
  document.getElementById('emp-email').value       = emp?.Email            || '';
  document.getElementById('emp-tgid').value        = emp?.Telegram_ID      || '';
  document.getElementById('emp-rol').value         = emp?.Rol              || 'empleado';
  document.getElementById('emp-notif').value       = emp?.Notificaciones   || 'privado';
  document.getElementById('emp-horas').value       = emp?.Horas_Anuales    || '1770';
  document.getElementById('emp-alarma').value      = emp?.Alarma_Descanso  || '25';
  document.getElementById('emp-confirmar').value   = emp?.Confirmar_Fichaje|| 'true';
  document.getElementById('modal-empleado')?.classList.remove('hidden');
  document.getElementById('emp-cancel').onclick = () => document.getElementById('modal-empleado')?.classList.add('hidden');
  document.getElementById('emp-save').onclick   = guardarEmpleadoForm;
}

function editarEmpleado(id) {
  const emp = state.empleados.find(e => e.ID_Empleado === id);
  if (emp) abrirFormEmpleado(emp);
}

async function guardarEmpleadoForm() {
  try {
    await api('guardarEmpleado', {
      id:               document.getElementById('emp-id').value,
      nombre:           document.getElementById('emp-nombre').value,
      numero:           document.getElementById('emp-numero').value,
      email:            document.getElementById('emp-email').value,
      telegramId:       document.getElementById('emp-tgid').value,
      rol:              document.getElementById('emp-rol').value,
      notificaciones:   document.getElementById('emp-notif').value,
      horasAnuales:     document.getElementById('emp-horas').value,
      alarmaDescanso:   document.getElementById('emp-alarma').value,
      confirmarFichaje: document.getElementById('emp-confirmar').value,
    });
    toast('✅ Empleado guardado', 'ok');
    document.getElementById('modal-empleado')?.classList.add('hidden');
    await cargarEmpleados();
  } catch (err) { toast('❌ ' + err.message, 'error'); }
}

// ── ADMIN: UBICACIONES ────────────────────────────────────────────
async function cargarUbicaciones() {
  const lista = document.getElementById('lista-ubicaciones'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    state.ubicaciones = await api('getUbicaciones');
    lista.innerHTML = state.ubicaciones.map(u => `
      <div class="admin-card">
        <div class="admin-card-info">
          <span>📍</span>
          <div>
            <div class="admin-card-name">${u.Nombre}</div>
            <div class="admin-card-sub">${u.Descripcion || ''}</div>
          </div>
        </div>
      </div>`).join('') || '<div class="empty-state">Sin ubicaciones</div>';
  } catch (err) {
    lista.innerHTML = '<div class="empty-state error">' + err.message + '</div>';
  }
}

// ── INCIDENCIAS ───────────────────────────────────────────────────
async function cargarIncidencias() {
  const lista = document.getElementById('lista-incidencias'); if (!lista) return;
  lista.innerHTML = '<div class="empty-state">Cargando…</div>';
  try {
    const data = await api('getIncidencias');
    if (!data.length) { lista.innerHTML = '<div class="empty-state">Sin incidencias</div>'; return; }
    lista.innerHTML = data.map(inc => `
      <div class="admin-card">
        <div class="admin-card-info">
          <span>⚠️</span>
          <div>
            <div class="admin-card-name">${inc.Tipo_Incidencia} — ${inc.Fecha}</div>
            <div class="admin-card-sub">${inc.Descripcion}</div>
          </div>
        </div>
        <span class="badge ${inc.Estado === 'resuelta' ? 'ok' : 'warn'}">${inc.Estado}</span>
      </div>`).join('');
  } catch (err) {
    lista.innerHTML = '<div class="empty-state error">' + err.message + '</div>';
  }
}

// ── UTILIDADES ────────────────────────────────────────────────────
function ocultarPantallas() {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
}

function mostrarErrorInicio(msg) {
  ocultarPantallas();
  document.getElementById('screen-login')?.classList.add('active');
  const status = document.getElementById('login-status');
  if (status) { status.textContent = msg; status.className = 'login-status error'; }
}

function toast(msg, tipo = 'ok') {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + tipo;
  setTimeout(() => el.className = 'toast hidden', 2800);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function horaActual() {
  const n = new Date();
  return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}

function fechaHoy() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

function formatearFecha(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

function toMins(horaStr) {
  if (!horaStr) return 0;
  const parts = horaStr.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

// Suma pares ENTRADA/SALIDA cerrados — para "Mis Fichajes"
function calcularHorasDia(fichajes) {
  if (!Array.isArray(fichajes) || fichajes.length < 2) return null;
  const ord = [...fichajes].sort((a, b) => (a.Hora || '').localeCompare(b.Hora || ''));
  let mins = 0;
  for (let i = 0; i < ord.length - 1; i += 2) {
    if (ord[i].Tipo === 'ENTRADA' && ord[i + 1]?.Tipo === 'SALIDA') {
      mins += toMins(ord[i + 1].Hora) - toMins(ord[i].Hora);
    }
  }
  return mins > 0 ? formatMins(mins) : null;
}

// Suma pares cerrados + entrada abierta actual — para modal de confirmación de salida
function calcularHorasAcumuladas(fichajes) {
  if (!Array.isArray(fichajes) || fichajes.length < 1) return null;
  const ord = [...fichajes].sort((a, b) => (a.Hora || '').localeCompare(b.Hora || ''));
  let mins = 0;
  // Sumar pares cerrados
  for (let i = 0; i < ord.length - 1; i += 2) {
    if (ord[i].Tipo === 'ENTRADA' && ord[i + 1]?.Tipo === 'SALIDA') {
      mins += toMins(ord[i + 1].Hora) - toMins(ord[i].Hora);
    }
  }
  // Si hay una entrada sin cerrar, sumar hasta ahora
  if (ord.length % 2 !== 0 && ord[ord.length - 1].Tipo === 'ENTRADA') {
    mins += toMins(horaActual()) - toMins(ord[ord.length - 1].Hora);
  }
  return mins > 0 ? formatMins(mins) : null;
}

function formatMins(mins) {
  return Math.floor(mins / 60) + 'h' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '');
}

function iniciarReloj() {
  const tick = () => {
    const now = new Date();
    const t = document.getElementById('clock-time');
    if (t) t.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const d = document.getElementById('clock-date');
    if (d) d.textContent = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  tick();
  clearInterval(window.__clockInt);
  window.__clockInt = setInterval(tick, 1000);
}

window.api = api;
