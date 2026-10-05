'use strict';
// Version del CODIGO de la app. Subirla solo cuando cambia comportamiento/diseno,
// nunca por cambios de datos (los datos viven en el telefono). Debe coincidir con sw.js.
const APP_VERSION = '2.0.1';

// Registro guardado: [MEDIDOR, RPU, CLIENTE, DIR1, DIR2, DIR3, COLONIA, TARIFA, CODIGO, LAT, LON, CUENTA, HILOS]
const C = { MED:0, RPU:1, CLI:2, D1:3, D2:4, D3:5, COL:6, TAR:7, COD:8, LAT:9, LON:10, CTA:11, HIL:12 };
const VECINOS = 5;          // registros antes y despues
const LEJOS_M = 500;        // vecino a mas de esto = GPS dudoso
const FUERA_KM = 100;       // punto a mas de esto del centro de la base = GPS dudoso
const MAX_LISTA = 50;

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtN = n => Number(n).toLocaleString('es-MX');
function toast(msg, ms = 2600){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function lsGet(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ================= ALMACENAMIENTO (IndexedDB) =================
let _db;
function idb(){
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('medadys', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('versiones', { keyPath: 'id' });   // metadatos
      d.createObjectStore('datos', { keyPath: 'id' });       // { id, rows }
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn){
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const dbAllVersions = () => tx('versiones', 'readonly', s => s.getAll());
const dbGetRows = id => tx('datos', 'readonly', s => s.get(id)).then(r => r ? r.rows : null);
async function dbSaveVersion(meta, rows){
  await tx('datos', 'readwrite', s => s.put({ id: meta.id, rows }));
  await tx('versiones', 'readwrite', s => s.put(meta));
}
async function dbDeleteVersion(id){
  await tx('datos', 'readwrite', s => s.delete(id));
  await tx('versiones', 'readwrite', s => s.delete(id));
}

// ================= VERSIONES EN MEMORIA =================
let versions = [];               // metadatos, ordenados de la mas nueva a la mas vieja
const loaded = new Map();        // id -> { meta, rows, byRpu, byMed }
let activeId = lsGet('activeId', null);

async function refreshVersions(){
  versions = (await dbAllVersions()).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.importado - a.importado);
  if (!versions.find(v => v.id === activeId)) { activeId = versions[0]?.id ?? null; lsSet('activeId', activeId); }
}
async function getVersion(id){
  if (loaded.has(id)) return loaded.get(id);
  const meta = versions.find(v => v.id === id); if (!meta) return null;
  const rows = await dbGetRows(id); if (!rows) return null;
  const byRpu = new Map(), byMed = new Map();
  rows.forEach((r, i) => {
    if (r[C.RPU] && !byRpu.has(r[C.RPU])) byRpu.set(r[C.RPU], i);
    const m = r[C.MED].toUpperCase(); if (m && !byMed.has(m)) byMed.set(m, i);
  });
  const v = { meta, rows, byRpu, byMed, txt: null };
  loaded.set(id, v); return v;
}
const metaOf = id => versions.find(v => v.id === id);
const verLabel = m => m ? `${m.nombre} · ${fmtFecha(m.fecha)}` : '';
function fmtFecha(f){ if (!f) return ''; const [y, m, d] = f.split('-'); return `${+d} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][+m-1]} ${y}`; }

// ================= GEO =================
function distM(a1, o1, a2, o2){
  const R = 6371000, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA/2)**2 + Math.cos(a1*r) * Math.cos(a2*r) * Math.sin(dO/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function rumbo(a1, o1, a2, o2){
  const r = Math.PI / 180;
  const y = Math.sin((o2-o1)*r) * Math.cos(a2*r);
  const x = Math.cos(a1*r)*Math.sin(a2*r) - Math.sin(a1*r)*Math.cos(a2*r)*Math.cos((o2-o1)*r);
  const b = (Math.atan2(y, x) / r + 360) % 360;
  return ['N','NE','E','SE','S','SO','O','NO'][Math.round(b / 45) % 8];
}
const fmtDist = m => m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(m < 10000 ? 1 : 0)} km`;
const hasGps = r => r[C.LAT] != null && r[C.LON] != null;
function gpsDudoso(r, meta){
  if (!hasGps(r)) return true;
  if (!meta?.centro) return false;
  return distM(r[C.LAT], r[C.LON], meta.centro[0], meta.centro[1]) > FUERA_KM * 1000;
}
const mapsUrl = r => `https://www.google.com/maps/search/?api=1&query=${r[C.LAT]},${r[C.LON]}`;
const direccion = r => [r[C.D1], r[C.D2], r[C.D3]].filter(Boolean).join(' · ');

// ================= TEXTO / BUSQUEDA =================
function norm(s){
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\bSIN NUMERO\b/g, 'SN').replace(/\bS N\b/g, 'SN').replace(/\bS\/N\b/g, 'SN')
    .replace(/\bAVENIDA\b/g, 'AV').replace(/\bESQUINA\b/g, 'ESQ').replace(/\bCOLONIA\b/g, 'COL')
    .replace(/\s+/g, ' ').trim();
}
// Fonetica para errores de ortografia comunes en espanol
function fon(s){
  return s.replace(/LL/g, 'Y').replace(/V/g, 'B').replace(/Z/g, 'S').replace(/C([EI])/g, 'S$1')
    .replace(/G([EI])/g, 'J$1').replace(/QU/g, 'K').replace(/C/g, 'K').replace(/H/g, '').replace(/(.)\1+/g, '$1');
}
function buildText(v){
  if (v.txt) return v.txt;
  v.txt = v.rows.map(r => {
    const n = ' ' + norm(r[C.CLI]) + ' ', d = ' ' + norm([r[C.D1], r[C.D2], r[C.D3], r[C.COL]].join(' ')) + ' ';
    return { n, d, fn: null, fd: null };
  });
  return v.txt;
}
function textSearch(v, query){
  const toks = norm(query).split(' ').filter(Boolean);
  if (!toks.length) return { hits: [], fuzzy: false };
  const txt = buildText(v);
  const run = (fuzzy) => {
    const qt = fuzzy ? toks.map(fon) : toks;
    const hits = [];
    for (let i = 0; i < txt.length; i++){
      const t = txt[i];
      let n = t.n, d = t.d;
      if (fuzzy){ if (t.fn == null){ t.fn = fon(n); t.fd = fon(d); } n = t.fn; d = t.fd; }
      let score = 0, ok = true;
      for (const q of qt){
        const sp = ' ' + q;
        if (n.includes(sp + ' ')) score += 4; else if (n.includes(sp)) score += 3;
        else if (d.includes(sp + ' ')) score += 2; else if (d.includes(sp)) score += 1;
        else { ok = false; break; }
      }
      if (ok) hits.push({ i, score });
    }
    hits.sort((a, b) => b.score - a.score || a.i - b.i);
    return hits;
  };
  let hits = run(false), fuzzy = false;
  if (!hits.length){ hits = run(true); fuzzy = hits.length > 0; }
  return { hits, fuzzy, toks };
}

// Busqueda exacta en la version activa y, si no aparece, en las demas (nueva -> vieja)
async function findExact(kind, key){
  key = key.trim().toUpperCase();
  const order = [activeId, ...versions.map(v => v.id).filter(id => id !== activeId)];
  for (const id of order){
    const v = await getVersion(id); if (!v) continue;
    const idx = (kind === 'rpu' ? v.byRpu : v.byMed).get(key);
    if (idx != null) return { vid: id, idx };
  }
  return null;
}
// Interpreta una linea "sucia" (numeracion, vinetas). lote=true: toma la 1a palabra como medidor.
function parseLinea(line, lote){
  const tok = line.trim().replace(/^\d{1,3}[.)]\s*/, '').replace(/^[-*•]\s*/, '').trim();
  if (!tok || (/^\d+$/.test(tok) && tok.length < 4)) return null;   // "2", "4" sueltos
  const m = tok.match(/\d{10,13}/);
  if (m) return { kind: 'rpu', key: m[0] };
  const words = tok.split(/\s+/);
  if (words.length > 1 && !lote) return null;
  return { kind: 'med', key: words[0] };
}

// ================= NAVEGACION (con historial del sistema: boton atras de Android/iOS) =================
let current = { s: 'home' };
function nav(state, replace = false){
  if (replace) history.replaceState(state, ''); else history.pushState(state, '');
  render(state);
}
window.addEventListener('popstate', e => render(e.state || { s: 'home' }));
document.addEventListener('click', e => {
  if (e.target.closest('[data-back]')) history.back();
  else if (e.target.closest('[data-home]')) nav({ s: 'home' });
});
function show(id){
  document.querySelectorAll('.screen').forEach(el => el.hidden = el.id !== id);
}
async function render(state){
  current = state;
  if (state.s !== 'mapa') stopWatch();
  switch (state.s){
    case 'ficha': show('scr-ficha'); await renderFicha(state); window.scrollTo(0, 0); break;
    case 'mapa': show('scr-mapa'); await renderMapa(state); break;
    case 'biblio': show('scr-biblio'); await renderBiblio(); break;
    case 'import': if (!pendingImport) return history.back(); show('scr-import'); renderImport(); break;
    default: show('scr-home'); renderHomeHeader();
  }
}

// ================= INICIO =================
function renderHomeHeader(){
  const m = metaOf(activeId);
  const pill = $('#activePill');
  pill.textContent = m ? `Base activa: ${verLabel(m)} · ${fmtN(m.total)} registros` : 'Sin base cargada — toca para importar';
  if (!m) $('#results').innerHTML = `<div class="empty">Todavía no hay ningún Excel en este teléfono.<br>Los datos se guardan solo aquí, no en internet.<button class="btn btn-amber btn-big" onclick="nav({s:'biblio'})">Importar mi primer Excel</button></div>`;
}
$('#activePill').onclick = () => nav({ s: 'biblio' });
$('#btnBiblioteca').onclick = () => nav({ s: 'biblio' });
$('#btnBuscar').onclick = buscar;
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !$('#q').value.includes('\n')){ e.preventDefault(); buscar(); } });

let lastText = null; // { vid, hits, fuzzy, toks, col }
async function buscar(){
  if (!activeId){ nav({ s: 'biblio' }); return; }
  const raw = $('#q').value;
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return;
  const out = $('#results');
  out.innerHTML = '<div class="progress">Buscando…</div>';
  $('#q').blur();

  if (lines.length > 1) return buscarLote(lines);

  const q = lines[0];
  const p = parseLinea(q);
  // 1 sola linea: primero exacto (RPU o medidor), si no, texto
  if (p){
    const hit = await findExact(p.kind, p.key);
    if (hit) return nav({ s: 'ficha', trail: [hit] });
    if (p.kind === 'rpu' && /^\d{10,13}$/.test(q)){ out.innerHTML = `<div class="empty">No se encontró el RPU <b>${esc(q)}</b> en ninguna versión.</div>`; return; }
  }
  const v = await getVersion(activeId);
  const r = textSearch(v, q);
  lastText = { vid: activeId, ...r, col: null, q };
  if (!r.hits.length){
    // Ultimo intento: texto en otras versiones
    for (const m of versions){ if (m.id === activeId) continue;
      const v2 = await getVersion(m.id); const r2 = textSearch(v2, q);
      if (r2.hits.length){ lastText = { vid: m.id, ...r2, col: null, q }; break; }
    }
  }
  renderTextResults();
}
function hl(text, toks){
  let s = esc(text);
  for (const t of toks || []){
    if (t.length < 2) continue;
    s = s.replace(new RegExp('(^|[^A-Z0-9Ñ])(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '$1<mark>$2</mark>');
  }
  return s;
}
function cardHtml(r, i, vid, toks, extra = ''){
  return `<button class="card" data-open="${vid}|${i}">
    <div class="card-top"><span class="med">${esc(r[C.MED])}</span><span class="cod">${esc(r[C.COD])}</span></div>
    <div class="cli">${hl(r[C.CLI], toks)}</div>
    <div class="dir">${hl(direccion(r), toks)} · ${hl(r[C.COL], toks)}</div>${extra}</button>`;
}
async function renderTextResults(){
  const L = lastText, out = $('#results');
  if (!L.hits.length){ out.innerHTML = `<div class="empty">Sin resultados para <b>${esc(L.q)}</b>.<br>Prueba con menos palabras o solo el apellido.</div>`; return; }
  const v = await getVersion(L.vid);
  let hits = L.hits;
  if (L.col) hits = hits.filter(h => v.rows[h.i][C.COL] === L.col);
  let html = `<div class="res-head"><span>${fmtN(hits.length)} resultado${hits.length !== 1 ? 's' : ''}${L.fuzzy ? ' parecidos (no exactos)' : ''}</span>${hits.length > MAX_LISTA ? `<span>mostrando ${MAX_LISTA}</span>` : ''}</div>`;
  if (L.vid !== activeId) html += `<div class="tag-warn">⚠ Encontrado en otra versión: ${esc(verLabel(metaOf(L.vid)))}</div>`;
  // Si hay muchos, ofrecer filtrar por colonia
  if (L.hits.length > 10){
    const cnt = new Map(); for (const h of L.hits){ const c = v.rows[h.i][C.COL]; cnt.set(c, (cnt.get(c) || 0) + 1); }
    const cols = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (cols.length > 1) html += `<div class="note">¿En qué colonia?</div><div class="chips">${L.col ? `<button class="chip" data-col="">✕ Todas</button>` : ''}${cols.map(([c, n]) => `<button class="chip${L.col === c ? ' on' : ''}" data-col="${esc(c)}">${esc(c)} (${n})</button>`).join('')}</div>`;
  }
  html += hits.slice(0, MAX_LISTA).map(h => cardHtml(v.rows[h.i], h.i, L.vid, L.toks)).join('');
  out.innerHTML = html;
}
async function buscarLote(lines){
  const seen = new Set(), found = [], notFound = [];
  for (const l of lines){
    const p = parseLinea(l, true); if (!p) continue;
    const k = p.key.toUpperCase(); if (seen.has(k)) continue; seen.add(k);
    const hit = await findExact(p.kind, p.key);
    if (hit) found.push(hit); else notFound.push(p.key);
  }
  let html = `<div class="res-head"><span class="sum-ok">✅ Encontrados: ${found.length}</span>${notFound.length ? `<span class="sum-bad">❌ No encontrados: ${notFound.length}</span>` : ''}</div>`;
  if (notFound.length) html += `<div class="notfound">${notFound.map(esc).join(', ')}</div>`;
  for (const f of found){
    const v = await getVersion(f.vid);
    const extra = f.vid !== activeId ? `<div class="tag-warn">⚠ De otra versión: ${esc(verLabel(v.meta))}</div>` : '';
    html += cardHtml(v.rows[f.idx], f.idx, f.vid, null, extra);
  }
  lastText = null;
  $('#results').innerHTML = html;
}
$('#results').addEventListener('click', e => {
  const c = e.target.closest('[data-col]');
  if (c){ lastText.col = c.dataset.col || null; renderTextResults(); return; }
  const o = e.target.closest('[data-open]');
  if (o){ const [vid, i] = o.dataset.open.split('|'); nav({ s: 'ficha', trail: [{ vid, idx: +i }] }); }
});

// ================= FICHA =================
function trailHtml(trail){
  if (trail.length < 2) return '';
  return trail.map((t, k) => {
    const v = loaded.get(t.vid); const lab = v ? v.rows[t.idx][C.MED] || v.rows[t.idx][C.RPU] : '?';
    return (k ? '<span class="sep">›</span>' : '') + `<button class="${k === trail.length - 1 ? 'cur' : ''}" data-trail="${k}">${esc(lab)}</button>`;
  }).join('');
}
async function renderFicha(st){
  const cur = st.trail[st.trail.length - 1];
  const v = await getVersion(cur.vid);
  if (!v){ $('#fichaBody').innerHTML = '<div class="empty">Esa versión ya no existe en el teléfono.</div>'; return; }
  for (const t of st.trail) await getVersion(t.vid);
  const r = v.rows[cur.idx];
  $('#fichaTitle').textContent = 'RPU ' + r[C.RPU];
  $('#trail').innerHTML = trailHtml(st.trail);
  const dud = gpsDudoso(r, v.meta);
  const otra = cur.vid !== activeId;

  // vecinos
  const a = Math.max(0, cur.idx - VECINOS), b = Math.min(v.rows.length - 1, cur.idx + VECINOS);
  let strip = '', list = '';
  for (let i = a; i <= b; i++){
    const n = v.rows[i], off = i - cur.idx;
    let d = null; if (off && hasGps(n) && hasGps(r)) d = distM(r[C.LAT], r[C.LON], n[C.LAT], n[C.LON]);
    const far = off && (d == null || d > LEJOS_M || gpsDudoso(n, v.meta));
    const dTxt = off ? (d == null ? 'sin GPS' : (far ? '⚠ ' : '') + fmtDist(d)) : 'aquí';
    strip += `<button class="nb${off ? '' : ' me'}${far ? ' far' : ''}" data-go="${i}"><b>${off > 0 ? '+' + off : off || '●'}</b><span class="c">${esc(n[C.COD]) || '—'}</span><br><span class="d">${dTxt}</span></button>`;
    if (off) list += `<button class="card" data-go="${i}"><div class="card-top"><span><span class="off">${off > 0 ? '+' + off : off}</span><span class="med" style="font-size:15px">${esc(n[C.MED])}</span></span><span><span class="dist${far ? ' far' : ''}">${dTxt}${d != null && hasGps(r) ? ' ' + rumbo(r[C.LAT], r[C.LON], n[C.LAT], n[C.LON]) : ''}</span> <span class="cod">${esc(n[C.COD])}</span></span></div><div class="cli" style="font-size:14px">${esc(n[C.CLI])}</div><div class="dir">${esc(direccion(n))}</div></button>`;
  }

  $('#fichaBody').innerHTML = `
    <div class="f-med"><span class="med">${esc(r[C.MED])}</span><span class="cod">${esc(r[C.COD])}</span></div>
    <div class="f-cli">${esc(r[C.CLI])}</div>
    <div class="f-dir">${esc(direccion(r))}<br>${esc(r[C.COL])}</div>
    <div class="f-meta">Tarifa ${esc(r[C.TAR])}${r[C.HIL] ? ' · ' + esc(r[C.HIL]) + ' hilos' : ''}${r[C.CTA] ? ' · Cta ' + esc(r[C.CTA]) : ''}</div>
    <div class="f-ver${otra ? ' other' : ''}">${otra ? '⚠ De otra versión (no es la activa): ' : 'Base: '}${esc(verLabel(v.meta))}</div>
    ${dud ? '<div class="tag-warn" style="display:block;margin-top:8px">⚠ GPS dudoso: la coordenada está muy lejos de la zona. Revisa el historial.</div>' : ''}
    <a class="btn btn-amber btn-big" ${hasGps(r) ? `href="${mapsUrl(r)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>📍 Ir al medidor</a>
    <div class="btn-row">
      <button class="btn btn-outline" id="btnVer11">🗺 Ver los ${b - a + 1}</button>
      <button class="btn" id="btnHist">🕘 Historial</button>
    </div>
    <div class="sec-label">Vecinos de ruta</div>
    <div class="strip" id="strip">${strip}</div>
    <div class="nlist">${list}</div>
    <div id="histBox"></div>`;
  const me = $('#strip .me'); if (me) me.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('#btnVer11').onclick = () => nav({ s: 'mapa', trail: st.trail });
  $('#btnHist').onclick = () => renderHistorial(r, cur.vid);
}
document.getElementById('scr-ficha').addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g){ const cur = current.trail.at(-1); if (+g.dataset.go === cur.idx) return;
    return nav({ s: 'ficha', trail: [...current.trail, { vid: cur.vid, idx: +g.dataset.go }] }); }
  const t = e.target.closest('[data-trail]');
  if (t){ const k = +t.dataset.trail; if (k < current.trail.length - 1) nav({ s: 'ficha', trail: current.trail.slice(0, k + 1) }); }
});

async function renderHistorial(r, vidActual){
  const box = $('#histBox');
  box.innerHTML = '<div class="sec-label">Historial en otras versiones</div><div class="progress">Revisando versiones…</div>';
  const filas = [];
  for (const m of versions){
    const v = await getVersion(m.id); const i = v.byRpu.get(r[C.RPU]);
    filas.push({ m, h: i == null ? null : v.rows[i], i });
  }
  let html = '<div class="sec-label">Historial en otras versiones</div><table class="hist">';
  for (const f of filas){
    const cur = f.m.id === vidActual;
    if (!f.h){ html += `<tr${cur ? ' class="cur"' : ''}><td>${esc(verLabel(f.m))}</td><td colspan="2" style="color:var(--dim)">No aparece</td></tr>`; continue; }
    const h = f.h, d = hasGps(h) && hasGps(r) ? distM(r[C.LAT], r[C.LON], h[C.LAT], h[C.LON]) : null;
    const medDif = h[C.MED] !== r[C.MED];
    html += `<tr${cur ? ' class="cur"' : ''}><td>${esc(verLabel(f.m))}${cur ? '<br><small>(viendo)</small>' : ''}</td>
      <td><span class="${medDif ? 'diff' : ''}" style="font-family:var(--mono)">${esc(h[C.MED])}</span> <span class="cod">${esc(h[C.COD])}</span></td>
      <td style="text-align:right">${hasGps(h) ? `<a href="${mapsUrl(h)}" target="_blank" rel="noopener">mapa</a><br><small class="${d > LEJOS_M / 5 ? 'warn' : ''}">${cur ? '' : d == null ? '' : (d < 1 ? 'igual' : fmtDist(d))}</small>` : '—'}</td></tr>`;
  }
  box.innerHTML = html + '</table><div class="note">La distancia es contra la ubicación de la versión que estás viendo. Medidor en rojo = era otro medidor.</div>';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ================= MAPA =================
let map, layers, layerName = lsGet('capa', 'sat'), markers = [], youMarker = null, watchId = null, youPos = null, tileErrors = 0;
function initMap(){
  if (map) return;
  map = L.map('map', { zoomControl: false, attributionControl: true });
  layers = {
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Imágenes © Esri' }),
    calles: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
  };
  for (const l of Object.values(layers)) l.on('tileerror', () => { if (++tileErrors === 3) mapNote('Sin internet: solo se ven los puntos'); });
  layers[layerName].addTo(map);
  map.on('click', () => { $('#sheet').hidden = true; markers.forEach(m => m._icon && m._icon.firstChild.classList.remove('sel')); });
}
function mapNote(t){ const n = $('#mapNote'); n.textContent = t; n.hidden = !t; }
$('#btnLayer').onclick = () => {
  map.removeLayer(layers[layerName]); layerName = layerName === 'sat' ? 'calles' : 'sat'; lsSet('capa', layerName);
  layers[layerName].addTo(map); toast(layerName === 'sat' ? 'Vista satélite' : 'Vista de calles', 1200);
};
$('#btnLocate').onclick = () => {
  if (!navigator.geolocation){ toast('Este teléfono no da ubicación'); return; }
  if (youPos) map.setView(youPos, Math.max(map.getZoom(), 16));
  startWatch(true);
};
function startWatch(center){
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(p => {
    youPos = [p.coords.latitude, p.coords.longitude];
    if (!youMarker) youMarker = L.marker(youPos, { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [16, 16] }), interactive: false }).addTo(map);
    else youMarker.setLatLng(youPos);
    if (center){ map.setView(youPos, Math.max(map.getZoom(), 16)); center = false; }
    if (!$('#sheet').hidden && renderMapa._sel != null) showSheet(renderMapa._sel, true);
  }, () => toast('No se pudo obtener tu ubicación'), { enableHighAccuracy: true, maximumAge: 5000 });
}
function stopWatch(){ if (watchId != null){ navigator.geolocation.clearWatch(watchId); watchId = null; } }

async function renderMapa(st){
  const cur = st.trail.at(-1);
  const v = await getVersion(cur.vid);
  initMap(); tileErrors = 0; mapNote(navigator.onLine ? '' : 'Sin internet: solo se ven los puntos');
  markers.forEach(m => m.remove()); markers = [];
  if (renderMapa._line) renderMapa._line.remove();
  const r = v.rows[cur.idx];
  $('#mapaTitle').textContent = `${r[C.MED]} · ruta`;
  const a = Math.max(0, cur.idx - VECINOS), b = Math.min(v.rows.length - 1, cur.idx + VECINOS);
  const pts = [], bounds = [];
  for (let i = a; i <= b; i++){
    const n = v.rows[i]; if (!hasGps(n) || gpsDudoso(n, v.meta)) continue;
    const off = i - cur.idx;
    const far = off && hasGps(r) && distM(r[C.LAT], r[C.LON], n[C.LAT], n[C.LON]) > LEJOS_M;
    const ll = [n[C.LAT], n[C.LON]]; pts.push(ll); if (!far) bounds.push(ll);
    const size = off ? 26 : 34;
    const mk = L.marker(ll, { zIndexOffset: off ? 0 : 1000, icon: L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
      html: `<div class="pin${off ? '' : ' me'}${far ? ' far' : ''}">${off > 0 ? '+' + off : off || '●'}</div>` }) }).addTo(map);
    mk.on('click', ev => { L.DomEvent.stop(ev); showSheet(i); });
    mk._row = i; markers.push(mk);
  }
  renderMapa._line = pts.length > 1 ? L.polyline(pts, { color: '#9aa3b8', weight: 2, dashArray: '5 6', interactive: false }).addTo(map) : null;
  renderMapa._v = v; renderMapa._cur = cur;
  map.invalidateSize();
  if (bounds.length > 1) map.fitBounds(bounds, { paddingTopLeft: [30, 30], paddingBottomRight: [30, 200], maxZoom: 18 });
  else if (bounds.length) map.setView(bounds[0], 17);
  else mapNote('Ningún punto de esta ruta tiene GPS válido');
  showSheet(cur.idx);
  if (navigator.geolocation) startWatch(false);
}
function showSheet(i, quiet){
  const v = renderMapa._v, cur = renderMapa._cur, r = v.rows[cur.idx], n = v.rows[i], off = i - cur.idx;
  renderMapa._sel = i;
  markers.forEach(m => m._icon && m._icon.firstChild.classList.toggle('sel', m._row === i && off !== 0));
  let rel = '';
  if (off && hasGps(n) && hasGps(r)) rel = `${fmtDist(distM(r[C.LAT], r[C.LON], n[C.LAT], n[C.LON]))} al ${rumbo(r[C.LAT], r[C.LON], n[C.LAT], n[C.LON])} del principal`;
  const tu = youPos && hasGps(n) ? `Estás a ${fmtDist(distM(youPos[0], youPos[1], n[C.LAT], n[C.LON]))}` : '';
  const s = $('#sheet');
  s.innerHTML = `<div class="grab"></div>
    <div class="card-top"><span><span class="off">${off > 0 ? '+' + off : off || '●'}</span><span class="med">${esc(n[C.MED])}</span></span><span class="cod">${esc(n[C.COD])}</span></div>
    <div class="cli">${esc(n[C.CLI])}</div>
    <div class="dir">${esc(direccion(n))}</div>
    <div class="dir" style="color:var(--amber)">${[off ? rel : 'Servicio principal', tu].filter(Boolean).join(' · ')}</div>
    <div class="btn-row">
      ${off ? `<button class="btn" id="sheetFicha">Ficha</button>` : ''}
      <a class="btn btn-amber" style="flex:1.4" ${hasGps(n) ? `href="${mapsUrl(n)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>📍 Ir aquí</a>
    </div>`;
  s.hidden = false;
  const f = $('#sheetFicha'); if (f) f.onclick = () => nav({ s: 'ficha', trail: [...current.trail, { vid: cur.vid, idx: i }] });
}

// ================= BIBLIOTECA =================
async function renderBiblio(){
  const box = $('#biblioList');
  if (!versions.length){ box.innerHTML = '<div class="empty">Aún no hay versiones. Importa el Excel que te da el sistema; la app acomoda las columnas.</div>'; }
  else box.innerHTML = versions.map(m => `
    <div class="ver${m.id === activeId ? ' active' : ''}">
      <div class="ver-name">${esc(m.nombre)}${m.id === activeId ? '<span class="badge-act">ACTIVA</span>' : ''}</div>
      <div class="ver-meta">Datos del ${fmtFecha(m.fecha)} · ${fmtN(m.total)} registros · ${fmtN(m.omitidos?.total || 0)} omitidos<br>Archivo: ${esc(m.archivo)}</div>
      <div class="btn-row">
        ${m.id === activeId ? '' : `<button class="btn btn-sm btn-amber" data-act="${m.id}">Usar esta</button>`}
        <button class="btn btn-sm" data-ren="${m.id}">Renombrar</button>
        <button class="btn btn-sm" data-del="${m.id}">Borrar</button>
      </div>
    </div>`).join('');
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) $('#storageInfo').textContent = `Espacio usado por la app: ${(e.usage / 1048576).toFixed(0)} MB`;
  } catch {}
}
$('#biblioList').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.act){ activeId = t.dataset.act; lsSet('activeId', activeId); toast('Base activa cambiada'); renderBiblio(); }
  else if (t.dataset.ren){
    const m = metaOf(t.dataset.ren); const n = prompt('Nombre de esta versión:', m.nombre);
    if (n && n.trim()){ m.nombre = n.trim(); await tx('versiones', 'readwrite', s => s.put(m)); renderBiblio(); }
  } else if (t.dataset.del){
    const m = metaOf(t.dataset.del);
    if (!confirm(`¿Borrar la versión "${m.nombre}" (${fmtN(m.total)} registros) de este teléfono?`)) return;
    await dbDeleteVersion(m.id); loaded.delete(m.id); await refreshVersions(); renderBiblio(); toast('Versión borrada');
  }
});

// ================= IMPORTAR EXCEL =================
const CAMPOS = [
  { k: 'rpu',  lab: 'RPU', req: true,  syn: ['rpu','registro permanente'] },
  { k: 'med',  lab: 'Medidor', req: true, syn: ['numed','medidor','num medidor','no medidor','numero medidor'] },
  { k: 'cod',  lab: 'Código de medidor', syn: ['codigomed','codigo med','codigo medidor','codigo','tipo medidor'] },
  { k: 'cli',  lab: 'Cliente / nombre', req: true, syn: ['nombre','cliente','nombre cliente'] },
  { k: 'd1',   lab: 'Dirección 1', req: true, syn: ['direccion','direccion 1','calle','domicilio'] },
  { k: 'd2',   lab: 'Dirección 2', syn: ['callead1','direccion 2','calle ad1','entre calle'] },
  { k: 'd3',   lab: 'Dirección 3', syn: ['callead2','direccion 3','calle ad2'] },
  { k: 'col',  lab: 'Colonia (nombre)', req: true, syn: ['colnombre','colonia nombre','nombre colonia','colonia'] },
  { k: 'tar',  lab: 'Tarifa', req: true, syn: ['tarifa'] },
  { k: 'cta',  lab: 'Cuenta', syn: ['numcta','cuenta','num cta'] },
  { k: 'hil',  lab: 'Hilos', syn: ['hilos'] },
  { k: 'lat',  lab: 'Latitud', syn: ['lat','latitud'] },
  { k: 'lon',  lab: 'Longitud', syn: ['lon','lng','longitud'] },
  { k: 'gps',  lab: 'GPS unido "lat,lon"', syn: ['gps','coordenadas','ubicacion'] },
];
let pendingImport = null; // { file, header, rows, map, nombre, fecha }
const keyNorm = s => norm(s).toLowerCase();

function loadXLSX(){
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel')); document.head.appendChild(s); });
}
$('#fileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  $('#biblioList').innerHTML = '<div class="progress">Leyendo el Excel… (puede tardar unos segundos)</div>';
  try {
    await loadXLSX();
    const buf = await file.arrayBuffer();
    await prepararImport(file.name, file.lastModified, buf);
    nav({ s: 'import' });
  } catch (err){
    renderBiblio(); alert('No se pudo leer el archivo: ' + err.message);
  }
});
async function prepararImport(nombreArchivo, lastModified, buf){
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  // hoja con mas filas
  let best = null;
  for (const n of wb.SheetNames){
    const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: false });
    if (!best || a.length > best.length) best = a;
  }
  if (!best || best.length < 2) throw new Error('El archivo no tiene datos');
  // fila de encabezados = primera con al menos 4 celdas con texto
  let h = best.findIndex(r => r.filter(c => String(c).trim()).length >= 4);
  if (h < 0) h = 0;
  const header = best[h].map(c => String(c).trim());
  const rows = best.slice(h + 1);
  const sig = header.map(keyNorm).join('|');
  const map = lsGet('map:' + sig, null) || detectar(header, rows);
  const d = lastModified ? new Date(lastModified) : new Date();
  pendingImport = { archivo: nombreArchivo, header, rows, map, sig, recordado: !!lsGet('map:' + sig, null),
    nombre: nombreArchivo.replace(/\.(xlsx|xls)$/i, ''),
    fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
}
function detectar(header, rows){
  const hk = header.map(keyNorm), map = {}, usado = new Set();
  for (const f of CAMPOS){
    for (const s of f.syn){ const i = hk.findIndex((k, j) => k === s && !usado.has(j)); if (i >= 0){ map[f.k] = i; usado.add(i); break; } }
  }
  // Coordenadas por VALORES (el sistema nombra X = latitud, Y = longitud)
  const muestra = rows.slice(0, 400);
  const med = j => { const v = muestra.map(r => parseFloat(r[j])).filter(x => isFinite(x) && x !== 0).sort((a, b) => a - b); return v.length > muestra.length * .3 ? v[v.length >> 1] : null; };
  if (map.lat == null || map.lon == null){
    for (let j = 0; j < header.length; j++){
      if (usado.has(j)) continue; const m = med(j); if (m == null) continue;
      if (map.lat == null && m > 14 && m < 33 && /^(x|y|lat|latitud|coord)/.test(hk[j] || 'x')){ map.lat = j; usado.add(j); }
      else if (map.lon == null && m < -86 && m > -118){ map.lon = j; usado.add(j); }
    }
  }
  if ((map.lat == null || map.lon == null) && map.gps == null){
    const j = header.findIndex((_, j) => muestra.filter(r => /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(String(r[j]).trim())).length > muestra.length * .3);
    if (j >= 0) map.gps = j;
  }
  // RPU por contenido si no hubo nombre
  if (map.rpu == null){ const j = header.findIndex((_, j) => muestra.filter(r => /^\d{12}$/.test(String(r[j]).trim())).length > muestra.length * .8); if (j >= 0) map.rpu = j; }
  return map;
}
function renderImport(){
  const P = pendingImport, opts = ['<option value="">— no usar —</option>', ...P.header.map((h, j) => `<option value="${j}">${esc(h || 'Columna ' + (j + 1))} (ej. ${esc(String(P.rows.find(r => String(r[j]).trim())?.[j] ?? '').slice(0, 18))})</option>`)].join('');
  let html = `<div class="note">${fmtN(P.rows.length)} filas en <b>${esc(P.archivo)}</b>. ${P.recordado ? '<span class="ok">Ya conozco este formato de Excel.</span>' : 'Revisa que cada dato apunte a la columna correcta:'}</div>`;
  for (const f of CAMPOS){
    const has = P.map[f.k] != null;
    const st = has ? '<span class="ok">✓</span>' : f.req ? '<span class="bad">falta</span>' : '';
    html += `<div class="field"><label>${f.lab} ${st}${f.k === 'lat' ? '<small>el sistema la llama X</small>' : f.k === 'lon' ? '<small>el sistema la llama Y</small>' : ''}</label><select data-f="${f.k}">${opts}</select></div>`;
  }
  html += `<div class="sec-label">Esta versión</div>
    <div class="field"><label>Nombre</label><input id="impNombre" value="${esc(P.nombre)}"></div>
    <div class="field"><label>Fecha de los datos<small>para ordenar versiones</small></label><input type="date" id="impFecha" value="${P.fecha}"></div>
    <div class="note">Se omiten los servicios sin tarifa, medidor, latitud/longitud, nombre, dirección o colonia.</div>
    <div id="impErr" class="bad note"></div>
    <button class="btn btn-amber btn-big" id="impGo">Importar</button>`;
  $('#importBody').innerHTML = html;
  document.querySelectorAll('#importBody select').forEach(s => { s.value = P.map[s.dataset.f] ?? ''; s.onchange = () => { if (s.value === '') delete P.map[s.dataset.f]; else P.map[s.dataset.f] = +s.value; }; });
  $('#impGo').onclick = ejecutarImport;
}
const cell = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v ?? '').trim();
async function ejecutarImport(){
  const P = pendingImport, M = P.map;
  const falta = CAMPOS.filter(f => f.req && M[f.k] == null).map(f => f.lab);
  if (!((M.lat != null && M.lon != null) || M.gps != null)) falta.push('Latitud y Longitud (o GPS unido)');
  if (falta.length){ $('#impErr').textContent = 'Falta indicar: ' + falta.join(', '); return; }
  P.nombre = $('#impNombre').value.trim() || P.nombre; P.fecha = $('#impFecha').value || P.fecha;
  $('#importBody').innerHTML = '<div class="progress">Acomodando datos…</div>';
  await new Promise(r => setTimeout(r, 30));
  const g = (r, k) => M[k] == null ? '' : cell(r[M[k]]);
  const om = { tarifa: 0, medidor: 0, gps: 0, nombre: 0, direccion: 0, colonia: 0, rpu: 0, total: 0 };
  const out = [], vistos = new Set();
  for (const r of P.rows){
    const rpu = g(r, 'rpu').replace(/\D/g, '');
    let lat, lon;
    if (M.lat != null && M.lon != null){ lat = parseFloat(g(r, 'lat')); lon = parseFloat(g(r, 'lon')); }
    else { const p = g(r, 'gps').split(','); lat = parseFloat(p[0]); lon = parseFloat(p[1]); }
    const rec = [g(r, 'med').toUpperCase(), rpu, g(r, 'cli'), g(r, 'd1'), g(r, 'd2'), g(r, 'd3'), g(r, 'col'), g(r, 'tar'), g(r, 'cod').toUpperCase(),
      isFinite(lat) && lat !== 0 ? +lat.toFixed(7) : null, isFinite(lon) && lon !== 0 ? +lon.toFixed(7) : null, g(r, 'cta'), g(r, 'hil')];
    let malo = false;
    if (!rpu || vistos.has(rpu)){ om.rpu++; malo = true; }
    if (!rec[C.TAR]){ om.tarifa++; malo = true; }
    if (!rec[C.MED]){ om.medidor++; malo = true; }
    if (rec[C.LAT] == null || rec[C.LON] == null){ om.gps++; malo = true; }
    if (!rec[C.CLI]){ om.nombre++; malo = true; }
    if (!rec[C.D1]){ om.direccion++; malo = true; }
    if (!rec[C.COL]){ om.colonia++; malo = true; }
    if (malo){ om.total++; continue; }
    vistos.add(rpu); out.push(rec);
  }
  if (!out.length){ alert('Ningún registro pasó los filtros. Revisa las columnas.'); return renderImport(); }
  const la = out.map(r => r[C.LAT]).sort((a, b) => a - b), lo = out.map(r => r[C.LON]).sort((a, b) => a - b);
  const centro = [la[la.length >> 1], lo[lo.length >> 1]];
  const meta = { id: 'v' + Date.now(), nombre: P.nombre, fecha: P.fecha, archivo: P.archivo, importado: Date.now(), total: out.length, omitidos: om, centro };
  try { await dbSaveVersion(meta, out); }
  catch (err){ alert('No se pudo guardar en el teléfono: ' + err.message); return renderImport(); }
  lsSet('map:' + P.sig, M);
  try { await navigator.storage?.persist?.(); } catch {}
  const primera = !activeId;
  await refreshVersions();
  if (primera){ activeId = meta.id; lsSet('activeId', activeId); }
  pendingImport = null;
  const dudosos = out.filter(r => gpsDudoso(r, meta)).length;
  $('#importBody').innerHTML = `<div class="empty" style="text-align:left">
    <div class="sec-label">Importado</div>
    <b class="ok">✓ ${fmtN(out.length)} registros guardados</b> en este teléfono.<br><br>
    Omitidos: ${fmtN(om.total)}<br>
    <small style="color:var(--muted)">sin medidor ${fmtN(om.medidor)} · sin lat/lon ${fmtN(om.gps)} · sin colonia ${fmtN(om.colonia)} · sin tarifa ${fmtN(om.tarifa)} · sin nombre ${fmtN(om.nombre)} · sin dirección ${fmtN(om.direccion)} · RPU vacío o repetido ${fmtN(om.rpu)}</small><br><br>
    ${dudosos ? `<span class="warn">⚠ ${fmtN(dudosos)} con GPS muy lejos de la zona (se marcan como dudosos).</span><br><br>` : ''}
    ${primera ? 'Es tu base activa.' : `<button class="btn btn-amber btn-big" id="impActivar">Usar esta versión como activa</button>`}
    <button class="btn btn-big" onclick="history.back()">Listo</button></div>`;
  const a = $('#impActivar'); if (a) a.onclick = () => { activeId = meta.id; lsSet('activeId', activeId); toast('Base activa cambiada'); history.back(); };
}

// ================= ARRANQUE =================
(async function init(){
  $('#appVer').textContent = 'Medidores v' + APP_VERSION + ' · los datos se guardan solo en este teléfono';
  try { await refreshVersions(); } catch (e){ $('#results').innerHTML = '<div class="empty">Este navegador no permite guardar datos: ' + esc(e.message) + '</div>'; }
  history.replaceState({ s: 'home' }, '');
  render({ s: 'home' });
  if (activeId) getVersion(activeId); // precarga en segundo plano
})();

// Service worker + aviso de nueva version de la app
if ('serviceWorker' in navigator){
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      let pedido = false; // recargar solo si el usuario toco "Actualizar" (no en la primera instalacion)
      const avisar = w => { $('#updateBar').hidden = false; $('#updateBtn').onclick = () => { pedido = true; w.postMessage('skipWaiting'); }; };
      if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); });
      });
      let recargando = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (pedido && !recargando){ recargando = true; location.reload(); } });
    } catch {}
  });
}
