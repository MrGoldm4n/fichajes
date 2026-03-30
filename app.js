// FICHAJES v0.5.1 — app.js limpio
const GOOGLE_CLIENT_ID = '920497100034-08on4kifjrp7l80doe6ucs49ahop5v8c.apps.googleusercontent.com';
const tg = window.Telegram?.WebApp;
const state = { empleado:null, ubicacion:null, estadoHoy:null, timerInterval:null, timerSeconds:0, empleados:[], ubicaciones:[], config:{} };

async function api(action, data = {}) {
  const telegramId = tg?.initDataUnsafe?.user?.id || '';
  const emailGoogle = state.empleado?.emailGoogle || '';
  const isWrite = ['fichar','corregirFichaje','guardarEmpleado','guardarUbicacion','resolverIncidencia','guardarConfig','loginGoogle'].includes(action);
  const payload = { action, telegramId, emailGoogle, ...data };
  const res = await fetch(APPS_SCRIPT_URL, isWrite ? { method:'POST', body: JSON.stringify(payload) } : { method:'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

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
      state.empleado = JSON.parse(saved);
      await arrancarApp(true);
      return;
    }
    mostrarLoginGoogle();
  } catch (err) {
    console.error(err);
    mostrarErrorInicio(err.message);
  }
});

function mostrarLoginGoogle() {
  ocultarPantallas();
  document.getElementById('screen-login')?.classList.add('active');
  const t = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(t);
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLogin });
      google.accounts.id.renderButton(document.getElementById('google-btn'), { theme:'filled_blue', size:'large', text:'signin_with', locale:'es', width:280 });
    }
  }, 150);
}

async function handleGoogleLogin(response) {
  const statusEl = document.getElementById('login-status');
  if (statusEl) statusEl.textContent = 'Verificando...';
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const res = await fetch(APPS_SCRIPT_URL, { method:'POST', body: JSON.stringify({ action:'loginGoogle', token:response.credential, email:payload.email }) });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'No autorizado');
    state.empleado = { ...data.empleado, emailGoogle: payload.email };
    localStorage.setItem('fichajes_emp', JSON.stringify(state.empleado));
    await arrancarApp(true);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
}

async function arrancarApp(yaAutenticado=false) {
  const emp = yaAutenticado ? state.empleado : await api('getEmpleado');
  state.empleado = emp;
  const [ubicaciones, config] = await Promise.all([api('getUbicaciones'), api('getConfig')]);
  state.ubicaciones = ubicaciones || [];
  state.config = config || {};
  actualizarUIEmpleado(emp);
  const locParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('loc') || '';
  if (locParam) state.ubicacion = state.ubicaciones.find(u => u.NFC_Param === locParam || u.ID_Ubicacion === locParam) || null;
  await refreshEstado();
  ocultarPantallas();
  document.getElementById('screen-fichar')?.classList.add('active');
  setupOnce();
  iniciarReloj();
  if (emp.Rol === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
}

function setupOnce() {
  if (window.__fichajesSetupDone) return;
  window.__fichajesSetupDone = true;
  document.getElementById('btn-fichar')?.addEventListener('click', () => prepararFichaje(false));
  document.getElementById('btn-alarma')?.addEventListener('click', iniciarTimerDescanso);
  document.getElementById('modal-cancel')?.addEventListener('click', () => document.getElementById('modal-confirmar')?.classList.add('hidden'));
  document.getElementById('modal-confirm')?.addEventListener('click', async () => ejecutarFichaje({ comentario: document.getElementById('modal-comentario')?.value?.trim() || '' }));
  document.getElementById('btn-volver-fichar')?.addEventListener('click', () => { clearInterval(state.timerInterval); document.getElementById('modal-alarma')?.classList.add('hidden'); prepararFichaje(false); });
  document.getElementById('btn-cancelar-timer')?.addEventListener('click', () => { clearInterval(state.timerInterval); document.getElementById('modal-alarma')?.classList.add('hidden'); });
}

function actualizarUIEmpleado(emp) {
  const ini = (emp.Nombre_Completo || '').split(' ').filter(Boolean).slice(0,2).map(n => n[0]).join('').toUpperCase();
  ['fichar-avatar','sidebar-avatar'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ini; });
  ['fichar-nombre','sidebar-name'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = emp.Nombre_Completo || ''; });
  const role = document.getElementById('sidebar-role'); if (role) role.textContent = emp.Rol || '';
}

async function refreshEstado() {
  state.estadoHoy = await api('getEstado');
  actualizarUIFichaje();
}

function actualizarUIFichaje() {
  const s = state.estadoHoy; if (!s) return;
  const badge = document.getElementById('tipo-badge'); if (badge) badge.textContent = s.proximoTipo || 'ENTRADA';
  const count = document.getElementById('fichar-count'); if (count) count.textContent = (s.totalFichajesHoy || 0) + ' fichaje' + ((s.totalFichajesHoy || 0) === 1 ? '' : 's') + ' hoy';
  const btn = document.getElementById('btn-fichar'); if (btn) btn.className = 'btn btn-fichar' + (s.proximoTipo === 'SALIDA' ? ' salida' : '');
}

async function prepararFichaje(autoConfirm) {
  await refreshEstado();
  const confirmar = state.empleado?.Confirmar_Fichaje !== 'false';
  if (autoConfirm || !confirmar) return ejecutarFichaje({ comentario: '' });
  document.getElementById('modal-icon').textContent = state.estadoHoy?.proximoTipo === 'ENTRADA' ? '🟢' : '🔴';
  document.getElementById('modal-titulo').textContent = 'Confirmar fichaje';
  document.getElementById('modal-subtitulo').textContent = (state.estadoHoy?.proximoTipo || 'ENTRADA') + ' — ' + horaActual();
  document.getElementById('modal-confirmar')?.classList.remove('hidden');
}

async function ejecutarFichaje({ comentario }) {
  try {
    const res = await api('fichar', {
      comentario,
      ubicacionId: state.ubicacion?.ID_Ubicacion || '',
      ubicacionNombre: state.ubicacion?.Nombre || 'Manual',
      metodo: state.ubicacion ? 'NFC' : (tg?.initDataUnsafe?.user ? 'MINI_APP' : 'WEB')
    });
    if (res.ok) {
      toast('✅ ' + res.tipo + ' a las ' + res.hora, 'ok');
      document.getElementById('modal-confirmar')?.classList.add('hidden');
      await refreshEstado();
      if (res.fichajeNum % 2 === 0) iniciarTimerDescanso();
    }
  } catch (err) {
    toast('❌ ' + err.message, 'error');
  }
}

function iniciarTimerDescanso() {
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
      toast('⏰ Descanso completado', 'warning');
    }
  }, 1000);
}

function actualizarTimerDisplay() {
  const el = document.getElementById('timer-display'); if (!el) return;
  const m = String(Math.floor(state.timerSeconds / 60)).padStart(2, '0');
  const s = String(state.timerSeconds % 60).padStart(2, '0');
  el.textContent = m + ':' + s;
}

function ocultarPantallas() {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('splash')?.classList.remove('active');
}

function mostrarErrorInicio(msg) {
  ocultarPantallas();
  const s = document.getElementById('screen-login');
  if (s) s.classList.add('active');
  const status = document.getElementById('login-status');
  if (status) status.textContent = msg;
}

function toast(msg, tipo='ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + tipo;
  setTimeout(() => el.className = 'toast hidden', 2500);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function horaActual() { const n = new Date(); return String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0'); }
function fechaHoy() { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0'); }

function iniciarReloj() {
  const tick = () => {
    const now = new Date();
    const t = document.getElementById('clock-time'); if (t) t.textContent = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const d = document.getElementById('clock-date'); if (d) d.textContent = fechaHoy();
  };
  tick();
  clearInterval(window.__clockInt);
  window.__clockInt = setInterval(tick, 1000);
}

function formatearFecha(str) {
  if (!str) return '';
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short' });
}

function calcularHorasDia(fichajes) {
  if (!Array.isArray(fichajes) || fichajes.length < 2) return null;
  const ord = [...fichajes].sort((a,b) => (a.Hora || '').localeCompare(b.Hora || ''));
  let mins = 0;
  for (let i = 0; i < ord.length - 1; i += 2) {
    if (ord[i].Tipo === 'ENTRADA' && ord[i+1]?.Tipo === 'SALIDA') {
      const [hE,mE] = (ord[i].Hora || '0:0').split(':').map(Number);
      const [hS,mS] = (ord[i+1].Hora || '0:0').split(':').map(Number);
      mins += (hS*60 + mS) - (hE*60 + mE);
    }
  }
  if (mins <= 0) return null;
  return Math.floor(mins/60) + 'h' + (mins%60 ? ' ' + mins%60 + 'm' : '');
}

window.api = api;
'''
Path('/root/output/app.js').write_text(app_js, encoding='utf-8')
print('app.js limpio generado:', len(app_js))
print('Últimos 120 caracteres:', app_js[-120:])
