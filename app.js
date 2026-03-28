// =====================================================
// FICHAJES v0.4.0 — app.js
// Telegram Mini App + Google Login + Apps Script API
// =====================================================

const GOOGLE_CLIENT_ID = 'https://920497100034-08on4kifjrp7l80doe6ucs49ahop5v8c.apps.googleusercontent.com'; // ← CAMBIA ESTO
const tg = window.Telegram?.WebApp;

const state = {
  empleado:      null,
  ubicacion:     null,
  estadoHoy:     null,
  timerInterval: null,
  timerSeconds:  0,
  empleados:     [],
  ubicaciones:   [],
  config:        {},
};

async function api(action, data = {}) {
  const telegramId  = tg?.initDataUnsafe?.user?.id || '';
  const emailGoogle = state.empleado?.emailGoogle || '';
  const isWrite = ['fichar','corregirFichaje','guardarEmpleado',
    'guardarUbicacion','resolverIncidencia','guardarConfig','loginGoogle'].includes(action);
  if (isWrite) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', redirect: 'follow',
      body: JSON.stringify({ action, telegramId, emailGoogle, ...data }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  } else {
    const params = new URLSearchParams({ action, telegramId, emailGoogle, ...data });
    const res = await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { redirect: 'follow' });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }
}

window.addEventListener('load', async () => {
  if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d0d1a'); tg.setBackgroundColor('#0d0d1a'); }
  await sleep(1200);
  const tgUser = tg?.initDataUnsafe?.user;
  if (tgUser?.id) {
    await arrancarApp();
  } else {
    mostrarLoginGoogle();
  }
});

function mostrarLoginGoogle() {
  document.getElementById('splash').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  const intentar = setInterval(() => {
    if (typeof google !== 'undefined' && google.accounts) {
      clearInterval(intentar);
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLogin });
      google.accounts.id.renderButton(
        document.getElementById('google-btn'),
        { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'es', width: 280 }
      );
    }
  }, 200);
}

async function handleGoogleLogin(response) {
  const statusEl = document.getElementById('login-status');
  statusEl.textContent = 'Verificando…';
  statusEl.className = 'login-status';
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', redirect: 'follow',
      body: JSON.stringify({ action: 'loginGoogle', token: response.credential, email: payload.email }),
    });
    const data = await res.json();
    if (data.success) {
      state.empleado = { ...data.empleado, emailGoogle: payload.email };
      document.getElementById('screen-login').classList.remove('active');
      await arrancarApp(true);
    } else {
      statusEl.textContent = data.message || 'No autorizado. Contacta con el administrador.';
      statusEl.className = 'login-status login-error';
    }
  } catch(err) {
    statusEl.textContent = 'Error de conexión: ' + err.message;
    statusEl.className = 'login-status login-error';
  }
}

async function arrancarApp(yaAutenticado = false) {
  try {
    let emp;
    if (yaAutenticado) {
      emp = state.empleado;
      const [ubicaciones, config] = await Promise.all([api('getUbicaciones'), api('getConfig')]);
      state.ubicaciones = ubicaciones; state.config = config;
    } else {
      const [empRes, ubicaciones, config] = await Promise.all([api('getEmpleado'), api('getUbicaciones'), api('getConfig')]);
      emp = empRes; state.empleado = emp; state.ubicaciones = ubicaciones; state.config = config;
    }
    actualizarUIEmpleado(emp);
    const urlParams = new URLSearchParams(window.location.search);
    const locParam  = tg?.initDataUnsafe?.start_param || urlParams.get('loc') || '';
    if (locParam) {
      state.ubicacion = state.ubicaciones.find(u => u.NFC_Param === locParam || u.ID_Ubicacion === locParam) || null;
      if (state.ubicacion) document.getElementById('fichar-ubicacion').textContent = '📍 ' + state.ubicacion.Nombre;
    }
    await refreshEstado();
    if (emp.Rol === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    if (locParam && state.ubicacion) await prepararFichaje(true);
  } catch(err) {
    if (err.message.includes('No autorizado')) mostrarNoAuth('');
    else toast('Error: ' + err.message, 'error');
    ocultarSplash('noauth'); return;
  }
  ocultarSplash('fichar'); iniciarReloj(); setupNavegacion(); setupModales();
}

function mostrarNoAuth(detalle) { const box = document.getElementById('tg-id-box'); if (box && detalle) box.textContent = detalle; }
function ocultarSplash(destino) { document.getElementById('splash').classList.remove('active'); document.getElementById('screen-' + destino).classList.add('active'); }

function actualizarUIEmpleado(emp) {
  const ini = emp.Nombre_Completo.split(' ').slice(0,2).map(n=>n[0]).join('').toUpperCase();
  document.getElementById('fichar-avatar').textContent  = ini;
  document.getElementById('fichar-nombre').textContent  = emp.Nombre_Completo;
  document.getElementById('sidebar-avatar').textContent = ini;
  document.getElementById('sidebar-name').textContent   = emp.Nombre_Completo;
  document.getElementById('sidebar-role').textContent   = emp.Rol;
}

async function refreshEstado() { state.estadoHoy = await api('getEstado'); actualizarUIFichaje(); }

function actualizarUIFichaje() {
  const s = state.estadoHoy; if (!s) return;
  const esSalida = s.proximoTipo === 'SALIDA';
  const badge = document.getElementById('tipo-badge');
  badge.textContent = s.proximoTipo; badge.className = 'tipo-badge' + (esSalida ? ' salida' : '');
  const btn = document.getElementById('btn-fichar');
  btn.className = 'btn btn-fichar' + (esSalida ? ' salida' : '');
  document.getElementById('btn-fichar-text').textContent = 'Registrar ' + s.proximoTipo;
  document.getElementById('fichar-count').textContent = s.totalFichajesHoy + ' fichaje' + (s.totalFichajesHoy!==1?'s':'') + ' hoy';
}

async function prepararFichaje(autoConfirm) {
  await refreshEstado();
  const tipo = state.estadoHoy?.proximoTipo || 'ENTRADA';
  const confirmar = state.empleado?.Confirmar_Fichaje !== 'false';
  if (tipo === 'SALIDA') mostrarModalSalida();
  else if (!autoConfirm && confirmar) mostrarModalConfirmar(tipo);
  else await ejecutarFichaje({ tipo, esDescanso: false, comentario: '' });
}

function mostrarModalConfirmar(tipo) {
  document.getElementById('modal-icon').textContent      = tipo==='ENTRADA' ? '🟢' : '🔴';
  document.getElementById('modal-titulo').textContent    = 'Confirmar ' + tipo;
  document.getElementById('modal-subtitulo').textContent = tipo + ' — ' + horaActual();
  document.getElementById('modal-resumen-horas').classList.add('hidden');
  document.getElementById('modal-tipo-salida').classList.add('hidden');
  document.getElementById('modal-btns-std').classList.remove('hidden');
  document.getElementById('modal-comentario').value = '';
  document.getElementById('modal-confirmar').classList.remove('hidden');
}

function mostrarModalSalida() {
  document.getElementById('modal-icon').textContent      = '🔴';
  document.getElementById('modal-titulo').textContent    = 'Registrar Salida';
  document.getElementById('modal-subtitulo').textContent = 'Salida — ' + horaActual();
  document.getElementById('resumen-valor').textContent   = calcularHorasTrabajadas();
  document.getElementById('modal-resumen-horas').classList.remove('hidden');
  document.getElementById('modal-tipo-salida').classList.remove('hidden');
  document.getElementById('modal-btns-std').classList.add('hidden');
  document.getElementById('modal-comentario').value = '';
  document.getElementById('modal-confirmar').classList.remove('hidden');
}

async function ejecutarFichaje({ tipo, esDescanso, comentario }) {
  document.getElementById('modal-confirmar').classList.add('hidden');
  toast('Registrando…');
  try {
    tg?.HapticFeedback?.impactOccurred('medium');
    const res = await api('fichar', {
      tipo, esDescanso, comentario,
      ubicacionId:     state.ubicacion?.ID_Ubicacion || '',
      ubicacionNombre: state.ubicacion?.Nombre || 'Manual',
      metodo:          state.ubicacion ? 'NFC' : (tg?.initDataUnsafe?.user ? 'MINI_APP' : 'WEB'),
    });
    if (res.ok) {
      tg?.HapticFeedback?.notificationOccurred('success');
      toast('✅ ' + tipo + ' a las ' + horaActual(), 'ok');
      await refreshEstado();
      if (esDescanso) iniciarTimerDescanso();
    }
  } catch(err) { tg?.HapticFeedback?.notificationOccurred('error'); toast('❌ ' + err.message, 'error'); }
}

function setupModales() {
  document.getElementById('btn-fichar').addEventListener('click', () => prepararFichaje(false));
  document.getElementById('modal-cancel').addEventListener('click', () => document.getElementById('modal-confirmar').classList.add('hidden'));
  document.getElementById('modal-confirm').addEventListener('click', async () => {
    await ejecutarFichaje({ tipo: state.estadoHoy?.proximoTipo || 'ENTRADA', esDescanso: false, comentario: document.getElementById('modal-comentario').value.trim() });
  });
  document.getElementById('btn-descanso').addEventListener('click', async () =>
    ejecutarFichaje({ tipo: 'SALIDA', esDescanso: true, comentario: document.getElementById('modal-comentario').value.trim() }));
  document.getElementById('btn-salida-ok').addEventListener('click', async () =>
    ejecutarFichaje({ tipo: 'SALIDA', esDescanso: false, comentario: document.getElementById('modal-comentario').value.trim() }));

  document.getElementById('btn-manual').addEventListener('click', async () => {
    document.getElementById('manual-fecha').value = fechaHoy();
    document.getElementById('manual-hora').value  = horaActual();
    document.getElementById('manual-tipo').value  = state.estadoHoy?.proximoTipo || 'ENTRADA';
    document.getElementById('manual-comentario').value = '';
    const wrap = document.getElementById('manual-emp-wrap');
    if (state.empleado?.Rol === 'admin') {
      wrap.classList.remove('hidden');
      if (!state.empleados.length) state.empleados = await api('getEmpleados');
      document.getElementById('manual-emp').innerHTML = state.empleados.map(e =>
        `<option value="${e.Numero_Empleado}">${e.Nombre_Completo}</option>`).join('');
    } else { wrap.classList.add('hidden'); }
    document.getElementById('modal-manual').classList.remove('hidden');
  });
  document.getElementById('manual-cancel').addEventListener('click', () => document.getElementById('modal-manual').classList.add('hidden'));
  document.getElementById('manual-confirm').addEventListener('click', async () => {
    document.getElementById('modal-manual').classList.add('hidden');
    try {
      const res = await api('fichar', {
        tipo: document.getElementById('manual-tipo').value,
        fecha: document.getElementById('manual-fecha').value,
        hora: document.getElementById('manual-hora').value + ':00',
        comentario: document.getElementById('manual-comentario').value.trim(),
        ubicacionNombre: 'Manual', metodo: 'MANUAL', esDescanso: false,
      });
      if (res.ok) { toast('✅ Fichaje manual registrado', 'ok'); await refreshEstado(); }
    } catch(err) { toast('❌ ' + err.message, 'error'); }
  });

  document.getElementById('btn-volver-fichar').addEventListener('click', () => {
    clearInterval(state.timerInterval); document.getElementById('modal-alarma').classList.add('hidden'); prepararFichaje(false);
  });
  document.getElementById('btn-cancelar-timer').addEventListener('click', () => {
    clearInterval(state.timerInterval); document.getElementById('modal-alarma').classList.add('hidden');
  });

  document.getElementById('btn-nuevo-empleado')?.addEventListener('click', () => abrirFormEmpleado(null));
  document.getElementById('emp-cancel').addEventListener('click', () => document.getElementById('modal-empleado').classList.add('hidden'));
  document.getElementById('emp-save').addEventListener('click', guardarEmpleadoForm);
  document.getElementById('btn-exportar-pdf')?.addEventListener('click', () => toast('PDF en próxima versión', 'info'));
}

function iniciarTimerDescanso() {
  const mins = parseInt(state.config?.ALARMA_DESCANSO || '25');
  state.timerSeconds = mins * 60;
  document.getElementById('modal-alarma').classList.remove('hidden');
  actualizarTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerSeconds--; actualizarTimerDisplay();
    if (state.timerSeconds <= 0) { clearInterval(state.timerInterval); toast('⏰ Descanso completado. ¡Vuelve a fichar!', 'warning'); tg?.HapticFeedback?.notificationOccurred('warning'); }
  }, 1000);
}

function actualizarTimerDisplay() {
  const m = String(Math.floor(state.timerSeconds/60)).padStart(2,'0');
  const s = String(state.timerSeconds%60).padStart(2,'0');
  document.getElementById('timer-display').textContent = m + ':' + s;
}

async function cargarDashboard() {
  const año = new Date().getFullYear().toString();
  document.getElementById('dash-año').textContent = año;
  if (state.empleado?.Rol === 'admin') {
    if (!state.empleados.length) state.empleados = await api('getEmpleados');
    const sel = document.getElementById('dash-emp-select');
    sel.innerHTML = state.empleados.map(e => `<option value="${e.Numero_Empleado}">${e.Nombre_Completo}</option>`).join('');
    sel.value = state.empleado.Numero_Empleado;
    sel.addEventListener('change', () => cargarResumen(sel.value, año));
  }
  await cargarResumen(state.empleado.Numero_Empleado, año);
}

async function cargarResumen(numEmp, año) {
  const resumen = await api('getResumen', { numEmp, año });
  const horasAnuales = parseFloat(state.empleado?.Horas_Anuales || 1770);
  const pct = Math.min((resumen.horasRealizadas / horasAnuales) * 100, 100);
  document.getElementById('dash-barra-anual').style.width = pct + '%';
  document.getElementById('dash-horas-real').textContent  = resumen.horasRealizadas + 'h';
  document.getElementById('dash-horas-obj').textContent   = '/ ' + horasAnuales + 'h';
  const dif = resumen.horasRealizadas - (resumen.horasObjetivo || 0);
  const difEl = document.getElementById('dash-diferencial');
  difEl.textContent = (dif >= 0 ? '+' : '') + dif.toFixed(1) + 'h';
  difEl.className = 'diferencial ' + (dif >= 0 ? 'pos' : 'neg');
  renderTrimestres(resumen, año); renderSemana(resumen.detalleDias);
  if (!document.getElementById('dash-mes').value)
    document.getElementById('dash-mes').value = año + '-' + String(new Date().getMonth()+1).padStart(2,'0');
  renderCalendario(document.getElementById('dash-mes').value, resumen.detalleDias);
}

function renderTrimestres(resumen, año) {
  const trimActual = Math.floor(new Date().getMonth() / 3);
  document.getElementById('trimestres-grid').innerHTML = ['Q1','Q2','Q3','Q4'].map((t,i) => {
    const obj = resumen.objetivosPorTrimestre[t] || null;
    const cls = i===trimActual?'activo':i<trimActual?'completado':'';
    const ini = i*3+1, fin = i*3+3;
    const hTrim = (resumen.detalleDias||[]).filter(d=>{ const m=parseInt(d.fecha.split('-')[1]); return m>=ini&&m<=fin; }).reduce((a,b)=>a+b.horas,0);
    return `<div class="trim-card ${cls}"><div class="trim-label">${t} · ${año}</div><div class="trim-horas">${hTrim.toFixed(1)}h</div><div class="trim-obj">${obj?'Obj: '+obj+'h':'—'}</div></div>`;
  }).join('');
}

document.addEventListener('change', async e => {
  if (e.target.id === 'dash-mes') {
    const numEmp = document.getElementById('dash-emp-select')?.value || state.empleado?.Numero_Empleado;
    const res = await api('getResumen', { numEmp, año: e.target.value.split('-')[0] });
    renderCalendario(e.target.value, res.detalleDias);
  }
  if (e.target.id === 'filter-mes') renderFichajesMes(e.target.value);
});

function renderCalendario(mesStr, detalleDias) {
  const [año, mes] = mesStr.split('-').map(Number);
  const porDia = {}; (detalleDias||[]).forEach(d => { porDia[d.fecha] = d; });
  const primerDia = new Date(año,mes-1,1).getDay();
  const offset = primerDia===0?6:primerDia-1;
  const diasMes = new Date(año,mes,0).getDate(); const hoy = fechaHoy();
  let html = ['L','M','X','J','V','S','D'].map(d=>`<div class="cal-day-header">${d}</div>`).join('');
  for (let i=0; i<offset; i++) html += '<div class="cal-day vacio"></div>';
  for (let d=1; d<=diasMes; d++) {
    const fStr = año+'-'+String(mes).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dia = porDia[fStr]; const esFin = [0,6].includes(new Date(año,mes-1,d).getDay());
    const cls = fStr===hoy?'hoy':dia?'ok':esFin?'vacio':'';
    html += `<div class="cal-day ${cls}"><span>${d}</span>${dia?'<span class="cal-horas">'+dia.horas.toFixed(1)+'h</span>':''}</div>`;
  }
  document.getElementById('calendario-grid').innerHTML = html;
}

function renderSemana(detalleDias) {
  const hoy = new Date(); const dSem = hoy.getDay()===0?6:hoy.getDay()-1;
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate()-dSem);
  document.getElementById('semana-bars').innerHTML = ['L','M','X','J','V','S','D'].map((d,i) => {
    const f = new Date(lunes); f.setDate(lunes.getDate()+i);
    const fStr = f.toISOString().split('T')[0];
    const h = (detalleDias||[]).find(x=>x.fecha===fStr)?.horas||0;
    const pct = Math.min((h/10)*100,100);
    return `<div class="semana-bar-wrap"><div class="semana-bar" style="height:${pct}%"></div><span class="semana-day-label">${d}</span></div>`;
  }).join('');
}

async function cargarMisFichajes() {
  const n = new Date();
  if (!document.getElementById('filter-mes').value)
    document.getElementById('filter-mes').value = n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0');
  await renderFichajesMes(document.getElementById('filter-mes').value);
}

async function renderFichajesMes(mesStr) {
  const [año,mes] = mesStr.split('-');
  const fichajes = await api('getFichajes', { fechaInicio: año+'-'+mes+'-01', fechaFin: año+'-'+mes+'-31' });
  const porDia = {}; fichajes.forEach(f => { if (!porDia[f.Fecha]) porDia[f.Fecha]=[]; porDia[f.Fecha].push(f); });
  const cont = document.getElementById('lista-fichajes');
  if (!Object.keys(porDia).length) { cont.innerHTML = '<div class="empty-state">Sin fichajes en este periodo</div>'; return; }
  cont.innerHTML = Object.entries(porDia).sort(([a],[b])=>b.localeCompare(a)).map(([fecha,filas]) => {
    const hTrab = calcularHorasDia(filas);
    return `<div class="dia-grupo"><div class="dia-titulo">${formatearFecha(fecha)}${hTrab?' · '+hTrab:''}</div>
      ${filas.sort((a,b)=>a.Hora.localeCompare(b.Hora)).map(f=>`
        <div class="fichaje-row">
          <div class="fich-tipo ${f.Tipo.toLowerCase()}">${f.Tipo==='ENTRADA'?'🟢':'🔴'}</div>
          <div class="fich-hora">${f.Hora.slice(0,5)}</div>
          <div class="fich-detalle">
            <div class="fich-ubi">${f.Ubicacion_Nombre||'—'}</div>
            ${f.Comentario?`<div class="fich-coment">"${f.Comentario}"</div>`:''}
            ${f.Es_Descanso==='true'?'<div class="fich-descanso">🍽️ Descanso</div>':''}
          </div>
          <span class="fich-metodo">${f.Metodo}</span>
        </div>`).join('')}
    </div>`;
  }).join('');
}

async function cargarEmpleados() {
  state.empleados =
