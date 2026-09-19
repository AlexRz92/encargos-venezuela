// =============================================================================
// Encargos para Venezuela - Aplicacion completa (FEAT-002 sobre FEAT-001)
// -----------------------------------------------------------------------------
// App "buildless": sin bundler ni npm. El cliente de Supabase se carga desde
// un CDN como modulo ES con la version mayor fijada. Toda la interfaz de
// usuario esta en espanol.
//
// Contenido:
//   1. Configuracion + cliente de Supabase (guarda contra config faltante)
//   2. Tema claro / oscuro con persistencia
//   3. Capa de datos (CRUD) sobre las tablas `people` e `items`
//   4. Realtime: suscripcion a postgres_changes en ambas tablas
//   5. Estado local + filtros (busqueda, solo pendientes, categoria)
//   6. Renderizado (secciones colapsables, progreso, contador global)
//   7. Formularios de agregar / editar / borrar (modal + inline)
//   8. Arranque
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -----------------------------------------------------------------------------
// 1. Configuracion: leer window.APP_CONFIG (definido en config.js)
// -----------------------------------------------------------------------------
const PLACEHOLDER_URL = 'https://YOUR-PROJECT.supabase.co';
const PLACEHOLDER_KEY = 'YOUR-ANON-KEY';

const config = window.APP_CONFIG || {};

/**
 * Indica si la configuracion de Supabase todavia tiene los valores de ejemplo
 * o esta incompleta.
 * @returns {boolean}
 */
function isConfigMissing() {
  const url = (config.SUPABASE_URL || '').trim();
  const key = (config.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return true;
  if (url === PLACEHOLDER_URL || key === PLACEHOLDER_KEY) return true;
  return false;
}

// -----------------------------------------------------------------------------
// 2. Cliente de Supabase
// -----------------------------------------------------------------------------
// Se crea solo si hay configuracion valida. Si falta, se muestra un aviso
// amistoso y `supabase` queda como null (siempre se verifica antes de usar).
export let supabase = null;

if (!isConfigMissing()) {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
} else {
  showConfigBanner();
}

/**
 * Muestra el aviso de configuracion faltante y oculta los estados de carga.
 */
function showConfigBanner() {
  const banner = document.getElementById('config-banner');
  if (banner) banner.hidden = false;
  const loading = document.getElementById('loading-state');
  if (loading) loading.hidden = true;
}

// -----------------------------------------------------------------------------
// 3. Tema: modo claro / oscuro con persistencia en localStorage
// -----------------------------------------------------------------------------
const THEME_KEY = 'vzla-theme';

/**
 * Devuelve el tema efectivo actual ('light' | 'dark').
 * @returns {'light' | 'dark'}
 */
function getCurrentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  const prefersDark =
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Aplica un tema, lo persiste y actualiza el icono del boton.
 * @param {'light' | 'dark'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    /* localStorage puede no estar disponible (modo privado); se ignora */
  }
  updateThemeToggleIcon(theme);
}

/**
 * Actualiza el icono/etiqueta del boton de tema.
 * @param {'light' | 'dark'} theme
 */
function updateThemeToggleIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const icon = btn.querySelector('span');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  btn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'
  );
}

/**
 * Alterna entre modo claro y oscuro.
 */
export function toggleTheme() {
  const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

/**
 * Conecta el boton de tema y sincroniza el icono inicial.
 */
function initTheme() {
  updateThemeToggleIcon(getCurrentTheme());
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', toggleTheme);
}

// -----------------------------------------------------------------------------
// 4. Categorias por defecto (en espanol)
// -----------------------------------------------------------------------------
const DEFAULT_CATEGORIES = [
  'ropa',
  'medicinas',
  'comida',
  'regalos',
  'calzado',
  'otros',
];

/**
 * Capitaliza la primera letra de una categoria para mostrarla.
 * @param {string} c
 * @returns {string}
 */
function labelForCategory(c) {
  if (!c) return '';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

// -----------------------------------------------------------------------------
// 5. Estado local
// -----------------------------------------------------------------------------
/** @type {Array<{id:string,name:string,position:number,created_at:string,items:Array}>} */
let people = [];

const COLLAPSE_KEY = 'vzla-collapsed'; // conjunto de ids colapsados

/** Filtros activos en la interfaz. */
const filters = {
  search: '',
  onlyPending: false,
  category: '',
};

/** Referencia al canal de realtime para poder limpiarlo/reconectar. */
let realtimeChannel = null;

/**
 * Bandera de reconexion en curso. Evita que una conexion inestable encole
 * varios reintentos superpuestos: solo se programa uno a la vez y se libera
 * cuando el canal vuelve a estar SUBSCRIBED.
 */
let reconnectPending = false;

// -----------------------------------------------------------------------------
// 5.1 Estado de colapso persistente (localStorage keyed by person id)
// -----------------------------------------------------------------------------
/**
 * Lee el conjunto de ids de personas colapsadas.
 * @returns {Set<string>}
 */
function readCollapsedSet() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

/**
 * Guarda el conjunto de ids colapsados.
 * @param {Set<string>} set
 */
function writeCollapsedSet(set) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch (e) {
    /* se ignora si no hay localStorage */
  }
}

/**
 * @param {string} personId
 * @returns {boolean}
 */
function isCollapsed(personId) {
  return readCollapsedSet().has(personId);
}

/**
 * Alterna el estado de colapso de una persona y lo persiste.
 * @param {string} personId
 */
function toggleCollapsed(personId) {
  const set = readCollapsedSet();
  if (set.has(personId)) set.delete(personId);
  else set.add(personId);
  writeCollapsedSet(set);
}

// -----------------------------------------------------------------------------
// 6. Capa de datos (CRUD) sobre Supabase
// -----------------------------------------------------------------------------

/**
 * Carga todas las personas con sus articulos, ordenadas.
 * @returns {Promise<Array>}
 */
async function fetchAll() {
  if (!supabase) return [];
  const { data: peopleRows, error: peopleErr } = await supabase
    .from('people')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (peopleErr) throw peopleErr;

  const { data: itemRows, error: itemsErr } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: true });
  if (itemsErr) throw itemsErr;

  const byPerson = new Map();
  (peopleRows || []).forEach((p) => byPerson.set(p.id, { ...p, items: [] }));
  (itemRows || []).forEach((it) => {
    const person = byPerson.get(it.person_id);
    if (person) person.items.push(it);
  });
  return [...byPerson.values()];
}

/**
 * Agrega una persona al final de la lista.
 * @param {string} name
 */
async function addPerson(name) {
  if (!supabase) return;
  // position se deriva del maximo local: si dos dispositivos agregan a la vez
  // pueden coincidir en position, pero el orden queda resuelto de forma
  // estable por el desempate de created_at (ver fetchAll y el sort de realtime).
  const nextPos =
    people.reduce((max, p) => Math.max(max, p.position || 0), 0) + 1;
  const { error } = await supabase
    .from('people')
    .insert({ name: name.trim(), position: nextPos });
  if (error) throw error;
}

/**
 * Renombra una persona.
 * @param {string} id
 * @param {string} name
 */
async function renamePerson(id, name) {
  if (!supabase) return;
  const { error } = await supabase
    .from('people')
    .update({ name: name.trim() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Borra una persona. Los articulos se eliminan en cascada (FK ON DELETE
 * CASCADE en la base de datos).
 * @param {string} id
 */
async function deletePerson(id) {
  if (!supabase) return;
  const { error } = await supabase.from('people').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Agrega un articulo a una persona.
 * @param {string} personId
 * @param {{name:string, quantity:number, notes:string, category:string}} data
 */
async function addItem(personId, data) {
  if (!supabase) return;
  const { error } = await supabase.from('items').insert({
    person_id: personId,
    name: data.name.trim(),
    quantity: Number.isFinite(data.quantity) && data.quantity > 0 ? data.quantity : 1,
    notes: (data.notes || '').trim(),
    category: data.category || 'otros',
    done: false,
  });
  if (error) throw error;
}

/**
 * Actualiza campos de un articulo.
 * @param {string} id
 * @param {{name?:string, quantity?:number, notes?:string, category?:string, done?:boolean}} patch
 */
async function updateItem(id, patch) {
  if (!supabase) return;
  const clean = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.quantity !== undefined)
    clean.quantity =
      Number.isFinite(patch.quantity) && patch.quantity > 0 ? patch.quantity : 1;
  if (patch.notes !== undefined) clean.notes = (patch.notes || '').trim();
  if (patch.category !== undefined) clean.category = patch.category || 'otros';
  if (patch.done !== undefined) clean.done = !!patch.done;
  const { error } = await supabase.from('items').update(clean).eq('id', id);
  if (error) throw error;
}

/**
 * Marca / desmarca un articulo como listo.
 * @param {string} id
 * @param {boolean} done
 */
async function toggleItemDone(id, done) {
  return updateItem(id, { done });
}

/**
 * Borra un articulo.
 * @param {string} id
 */
async function deleteItem(id) {
  if (!supabase) return;
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// 7. Realtime: suscripcion a postgres_changes en `people` e `items`
// -----------------------------------------------------------------------------

/**
 * Aplica un evento de realtime al estado local (sin recargar todo) y re-renderiza.
 * Como respaldo, ante cualquier duda se puede recargar con reloadAndRender().
 * @param {'people'|'items'} table
 * @param {{eventType:string,new:object,old:object}} payload
 */
function applyRealtimeChange(table, payload) {
  const type = payload.eventType;
  if (table === 'people') {
    if (type === 'INSERT') {
      if (!people.some((p) => p.id === payload.new.id)) {
        people.push({ ...payload.new, items: [] });
      }
    } else if (type === 'UPDATE') {
      const p = people.find((x) => x.id === payload.new.id);
      if (p) Object.assign(p, payload.new);
      else people.push({ ...payload.new, items: [] });
    } else if (type === 'DELETE') {
      people = people.filter((p) => p.id !== payload.old.id);
    }
    people.sort(
      (a, b) =>
        (a.position || 0) - (b.position || 0) ||
        String(a.created_at).localeCompare(String(b.created_at))
    );
  } else if (table === 'items') {
    if (type === 'INSERT') {
      const person = people.find((p) => p.id === payload.new.person_id);
      if (person && !person.items.some((i) => i.id === payload.new.id)) {
        person.items.push(payload.new);
      }
    } else if (type === 'UPDATE') {
      // El articulo puede haber cambiado de persona: se quita de donde este.
      let moved = null;
      people.forEach((p) => {
        const idx = p.items.findIndex((i) => i.id === payload.new.id);
        if (idx !== -1) {
          moved = p.items.splice(idx, 1)[0];
        }
      });
      const target = people.find((p) => p.id === payload.new.person_id);
      if (target) {
        target.items.push({ ...(moved || {}), ...payload.new });
      } else {
        // La persona destino no esta en el estado local (su INSERT aun no
        // llego o se perdio). Ya sacamos el articulo de su lugar previo, asi
        // que para no perderlo recargamos todo desde Supabase.
        reloadAndRender().catch(() => {});
        return;
      }
    } else if (type === 'DELETE') {
      people.forEach((p) => {
        p.items = p.items.filter((i) => i.id !== payload.old.id);
      });
    }
  }
  render();
}

/**
 * Se suscribe a los cambios en ambas tablas. Maneja limpieza y reconexion.
 */
function subscribeRealtime() {
  if (!supabase) return;
  // Limpia una suscripcion previa antes de crear otra (reconexion).
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel('encargos-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'people' },
      (payload) => applyRealtimeChange('people', payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items' },
      (payload) => applyRealtimeChange('items', payload)
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Conexion restablecida: se libera la bandera de reintento.
        reconnectPending = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Si el canal se cae, se intenta reconectar tras un breve retardo,
        // pero solo un reintento a la vez aunque la conexion parpadee.
        if (reconnectPending) return;
        reconnectPending = true;
        setTimeout(() => {
          reloadAndRender().catch(() => {});
          subscribeRealtime();
        }, 3000);
      }
    });
}

// -----------------------------------------------------------------------------
// 8. Carga inicial + recarga
// -----------------------------------------------------------------------------

/**
 * Recarga el estado desde Supabase y re-renderiza.
 */
async function reloadAndRender() {
  people = await fetchAll();
  render();
}

// -----------------------------------------------------------------------------
// 9. Filtrado
// -----------------------------------------------------------------------------

/**
 * Devuelve true si un articulo pasa los filtros de busqueda/pendientes/categoria.
 * @param {object} item
 * @returns {boolean}
 */
function itemMatchesFilters(item) {
  if (!itemMatchesFiltersIgnoringSearch(item)) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const hay =
      (item.name || '').toLowerCase().includes(q) ||
      (item.notes || '').toLowerCase().includes(q);
    if (!hay) return false;
  }
  return true;
}

/**
 * Como itemMatchesFilters pero SIN aplicar el texto de busqueda. Solo evalua
 * los filtros de "solo pendientes" y categoria. Se usa cuando la persona
 * coincide por nombre y queremos mostrar todos sus articulos.
 * @param {object} item
 * @returns {boolean}
 */
function itemMatchesFiltersIgnoringSearch(item) {
  if (filters.onlyPending && item.done) return false;
  if (filters.category && (item.category || 'otros') !== filters.category)
    return false;
  return true;
}

/**
 * Indica si hay algun filtro activo.
 * @returns {boolean}
 */
function anyFilterActive() {
  return !!(filters.search || filters.onlyPending || filters.category);
}

/**
 * Devuelve true si el nombre de la persona coincide con el texto de busqueda.
 * Util cuando hay muchas personas y se quiere encontrar una rapido por nombre.
 * @param {object} person
 * @returns {boolean}
 */
function personNameMatchesSearch(person) {
  if (!filters.search) return false;
  const q = filters.search.toLowerCase();
  return (person.name || '').toLowerCase().includes(q);
}

/**
 * Reune el conjunto de categorias efectivamente en uso mas las por defecto.
 * @returns {string[]}
 */
function categoriesInUse() {
  const set = new Set(DEFAULT_CATEGORIES);
  people.forEach((p) =>
    p.items.forEach((it) => {
      if (it.category) set.add(it.category);
    })
  );
  return [...set];
}

// -----------------------------------------------------------------------------
// 10. Renderizado
// -----------------------------------------------------------------------------

/**
 * Crea un elemento con clases y (opcional) texto.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Calcula totales globales (total de articulos y cuantos listos).
 * @returns {{total:number, done:number}}
 */
function computeGlobalTotals() {
  let total = 0;
  let done = 0;
  people.forEach((p) =>
    p.items.forEach((it) => {
      total += 1;
      if (it.done) done += 1;
    })
  );
  return { total, done };
}

/**
 * Actualiza el contador global y la barra de progreso general.
 */
function renderGlobalSummary() {
  const { total, done } = computeGlobalTotals();
  const countEl = document.getElementById('global-count');
  if (countEl) countEl.textContent = `${done} de ${total}`;
  const bar = document.getElementById('global-progress-bar');
  const wrap = bar ? bar.parentElement : null;
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = `${pct}%`;
  if (wrap) {
    wrap.setAttribute('aria-valuenow', String(pct));
    wrap.classList.toggle('is-complete', total > 0 && done === total);
  }
}

/**
 * Rellena el selector de categorias del filtro conservando la seleccion.
 */
function renderCategoryFilter() {
  const select = document.getElementById('filter-category');
  if (!select) return;
  const current = filters.category;
  select.innerHTML = '';
  const optAll = el('option', undefined, 'Todas las categorías');
  optAll.value = '';
  select.appendChild(optAll);
  categoriesInUse().forEach((c) => {
    const opt = el('option', undefined, labelForCategory(c));
    opt.value = c;
    if (c === current) opt.selected = true;
    select.appendChild(opt);
  });
}

/**
 * Renderiza un articulo como <li>.
 * @param {object} item
 * @param {object} person
 * @returns {HTMLElement}
 */
function renderItem(item, person) {
  const li = el('li', 'item' + (item.done ? ' is-done' : ''));

  const check = el('input', 'item-check');
  check.type = 'checkbox';
  check.checked = !!item.done;
  check.setAttribute(
    'aria-label',
    item.done ? `Marcar "${item.name}" como pendiente` : `Marcar "${item.name}" como listo`
  );
  check.addEventListener('change', async () => {
    check.disabled = true;
    try {
      await toggleItemDone(item.id, check.checked);
      item.done = check.checked; // optimista; realtime confirmara
      render();
    } catch (e) {
      check.checked = !check.checked;
      showError('No se pudo actualizar el artículo.');
    } finally {
      check.disabled = false;
    }
  });

  const main = el('div', 'item-main');
  const nameRow = el('div', 'item-name');
  nameRow.appendChild(document.createTextNode(item.name || ''));
  if (item.quantity && item.quantity > 1) {
    nameRow.appendChild(el('span', 'item-qty', `x${item.quantity}`));
  }
  main.appendChild(nameRow);

  if (item.notes) {
    main.appendChild(el('div', 'item-notes', item.notes));
  }

  if (item.category) {
    const tags = el('div', 'item-tags');
    tags.appendChild(el('span', 'tag', labelForCategory(item.category)));
    main.appendChild(tags);
  }

  const actions = el('div', 'item-actions');
  const editBtn = el('button', 'btn btn-ghost btn-icon', '✏️');
  editBtn.type = 'button';
  editBtn.title = 'Editar artículo';
  editBtn.setAttribute('aria-label', 'Editar artículo');
  editBtn.addEventListener('click', () => openItemModal(person, item));

  const delBtn = el('button', 'btn btn-ghost btn-icon', '🗑️');
  delBtn.type = 'button';
  delBtn.title = 'Borrar artículo';
  delBtn.setAttribute('aria-label', 'Borrar artículo');
  delBtn.addEventListener('click', async () => {
    if (!confirm(`¿Borrar el artículo "${item.name}"?`)) return;
    try {
      await deleteItem(item.id);
      person.items = person.items.filter((i) => i.id !== item.id);
      render();
    } catch (e) {
      showError('No se pudo borrar el artículo.');
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  li.appendChild(check);
  li.appendChild(main);
  li.appendChild(actions);
  return li;
}

/**
 * Renderiza una persona como tarjeta colapsable.
 * @param {object} person
 * @returns {HTMLElement}
 */
function renderPerson(person, forceExpanded) {
  const total = person.items.length;
  const doneCount = person.items.filter((i) => i.done).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  // Con un filtro activo, una tarjeta con coincidencias se muestra expandida
  // aunque el usuario la haya colapsado, para que los resultados sean visibles.
  // El estado de colapso guardado en localStorage no se modifica, asi que al
  // limpiar los filtros la tarjeta vuelve a su estado previo.
  const collapsed = forceExpanded ? false : isCollapsed(person.id);

  const card = el('div', 'person-card' + (collapsed ? ' is-collapsed' : ''));

  // ---- Encabezado (boton que colapsa/expande) ----
  const header = el('button', 'person-header');
  header.type = 'button';
  header.setAttribute('aria-expanded', String(!collapsed));

  header.appendChild(el('span', 'person-toggle-icon', '▾'));

  const info = el('div', 'person-info');
  info.appendChild(el('div', 'person-name', person.name));

  const meta = el('div', 'person-meta');
  meta.appendChild(el('span', 'person-count', `${doneCount} de ${total} listos`));
  const prog = el('div', 'progress' + (total > 0 && doneCount === total ? ' is-complete' : ''));
  prog.setAttribute('role', 'progressbar');
  prog.setAttribute('aria-valuenow', String(pct));
  prog.setAttribute('aria-valuemin', '0');
  prog.setAttribute('aria-valuemax', '100');
  const bar = el('div', 'progress__bar');
  bar.style.width = `${pct}%`;
  prog.appendChild(bar);
  meta.appendChild(prog);
  info.appendChild(meta);
  header.appendChild(info);

  header.addEventListener('click', () => {
    toggleCollapsed(person.id);
    card.classList.toggle('is-collapsed');
    header.setAttribute(
      'aria-expanded',
      String(!card.classList.contains('is-collapsed'))
    );
  });

  // ---- Acciones de la persona (editar / borrar) ----
  const actions = el('div', 'person-actions');
  const editBtn = el('button', 'btn btn-ghost btn-icon', '✏️');
  editBtn.type = 'button';
  editBtn.title = 'Renombrar persona';
  editBtn.setAttribute('aria-label', 'Renombrar persona');
  editBtn.addEventListener('click', () => openPersonModal(person));

  const delBtn = el('button', 'btn btn-ghost btn-icon', '🗑️');
  delBtn.type = 'button';
  delBtn.title = 'Borrar persona';
  delBtn.setAttribute('aria-label', 'Borrar persona');
  delBtn.addEventListener('click', async () => {
    if (
      !confirm(
        `¿Borrar a "${person.name}" y todos sus artículos? Esta acción no se puede deshacer.`
      )
    )
      return;
    try {
      await deletePerson(person.id);
      people = people.filter((p) => p.id !== person.id);
      render();
    } catch (e) {
      showError('No se pudo borrar la persona.');
    }
  });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  const headerWrap = el('div', 'person-header-wrap');
  headerWrap.style.display = 'flex';
  headerWrap.style.alignItems = 'center';
  headerWrap.appendChild(header);
  headerWrap.appendChild(actions);
  card.appendChild(headerWrap);

  // ---- Cuerpo (articulos + agregar) ----
  const body = el('div', 'person-body');

  // Si el nombre de la persona coincide con la busqueda, mostramos TODOS sus
  // articulos (ignorando el texto de busqueda para esta persona, pero
  // respetando los filtros de "solo pendientes" y categoria). Asi, al buscar
  // por nombre, se ve la lista completa de esa persona.
  const nameMatch = personNameMatchesSearch(person);
  const visibleItems = person.items.filter((it) =>
    nameMatch ? itemMatchesFiltersIgnoringSearch(it) : itemMatchesFilters(it)
  );

  if (person.items.length === 0) {
    body.appendChild(
      el('p', 'no-results', 'Sin artículos todavía. Agrega el primero abajo.')
    );
  } else if (visibleItems.length === 0) {
    body.appendChild(el('p', 'no-results', 'Sin resultados con los filtros actuales.'));
  } else {
    const list = el('ul', 'item-list');
    visibleItems.forEach((it) => list.appendChild(renderItem(it, person)));
    body.appendChild(list);
  }

  const addItemBtn = el('button', 'btn btn-ghost btn-block', '＋ Agregar artículo');
  addItemBtn.type = 'button';
  addItemBtn.style.marginTop = '10px';
  addItemBtn.addEventListener('click', () => openItemModal(person, null));
  body.appendChild(addItemBtn);

  card.appendChild(body);
  return card;
}

/**
 * Render principal: contador global, filtro de categorias y lista de personas.
 */
function render() {
  renderGlobalSummary();
  renderCategoryFilter();

  const listEl = document.getElementById('people-list');
  const emptyEl = document.getElementById('empty-state');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (people.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  // Cuando hay filtros activos, ocultamos personas sin resultados.
  const filtering = anyFilterActive();
  let anyShown = false;

  people.forEach((person) => {
    if (filtering) {
      // La persona se muestra si su nombre coincide con la busqueda, o si
      // tiene algun articulo que pase los filtros. Buscar por nombre facilita
      // encontrar una persona rapido cuando la lista es larga.
      const nameMatch = personNameMatchesSearch(person);
      const hasMatch = nameMatch || person.items.some(itemMatchesFilters);
      if (!hasMatch) return;
    }
    anyShown = true;
    // Al filtrar, forzamos la expansion para que las coincidencias se vean
    // aunque la tarjeta estuviera colapsada.
    listEl.appendChild(renderPerson(person, filtering));
  });

  if (filtering && !anyShown) {
    listEl.appendChild(
      el('p', 'no-results', 'Sin resultados. Prueba con otros filtros o búsqueda.')
    );
  }
}

// -----------------------------------------------------------------------------
// 11. Estados de carga / error
// -----------------------------------------------------------------------------

/**
 * Muestra u oculta el estado de carga.
 * @param {boolean} on
 */
function setLoading(on) {
  const loading = document.getElementById('loading-state');
  if (loading) loading.hidden = !on;
}

/**
 * Muestra un mensaje de error reutilizando el banner.
 * @param {string} message
 */
function showError(message) {
  const banner = document.getElementById('config-banner');
  if (banner) {
    banner.hidden = false;
    const title = banner.querySelector('.banner__title');
    if (title) title.textContent = '⚠️ Ocurrió un problema';
    const p = banner.querySelector('p');
    if (p) {
      p.textContent =
        message +
        ' Revisa tu conexión y la configuración de Supabase, luego recarga la página.';
    }
  } else {
    alert(message);
  }
}

// -----------------------------------------------------------------------------
// 12. Modal reutilizable
// -----------------------------------------------------------------------------

/**
 * Abre el modal con un titulo y un nodo de contenido.
 * @param {string} title
 * @param {HTMLElement} contentNode
 */
function openModal(title, contentNode) {
  const backdrop = document.getElementById('modal-backdrop');
  const titleEl = document.getElementById('modal-title');
  const contentEl = document.getElementById('modal-content');
  if (!backdrop || !contentEl) return;
  if (titleEl) titleEl.textContent = title;
  contentEl.innerHTML = '';
  contentEl.appendChild(contentNode);
  backdrop.hidden = false;

  // Cerrar al hacer clic fuera o con Escape.
  backdrop.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onEscKey);

  // Enfocar el primer campo.
  const firstField = contentEl.querySelector('input, textarea, select, button');
  if (firstField) firstField.focus();
}

function onBackdropClick(e) {
  if (e.target && e.target.id === 'modal-backdrop') closeModal();
}

function onEscKey(e) {
  if (e.key === 'Escape') closeModal();
}

/**
 * Cierra el modal.
 */
function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.removeEventListener('click', onBackdropClick);
  document.removeEventListener('keydown', onEscKey);
  const contentEl = document.getElementById('modal-content');
  if (contentEl) contentEl.innerHTML = '';
}

// -----------------------------------------------------------------------------
// 13. Formularios: persona (agregar / renombrar)
// -----------------------------------------------------------------------------

/**
 * Abre el modal para agregar (person=null) o renombrar una persona.
 * @param {object|null} person
 */
function openPersonModal(person) {
  const isEdit = !!person;
  const form = el('form', 'inline-form');

  const nameInput = el('input', 'input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Nombre de la persona';
  nameInput.required = true;
  nameInput.maxLength = 80;
  nameInput.value = isEdit ? person.name : '';
  form.appendChild(nameInput);

  const actions = el('div', 'form-actions');
  const saveBtn = el('button', 'btn btn-primary', isEdit ? 'Guardar' : 'Agregar');
  saveBtn.type = 'submit';
  const cancelBtn = el('button', 'btn btn-ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        await renamePerson(person.id, name);
        person.name = name;
      } else {
        await addPerson(name);
        await reloadAndRender(); // asegura traer id/position reales
      }
      render();
      closeModal();
    } catch (err) {
      saveBtn.disabled = false;
      showError(isEdit ? 'No se pudo renombrar la persona.' : 'No se pudo agregar la persona.');
    }
  });

  openModal(isEdit ? 'Renombrar persona' : 'Agregar persona', form);
}

// -----------------------------------------------------------------------------
// 14. Formularios: articulo (agregar / editar)
// -----------------------------------------------------------------------------

/**
 * Abre el modal para agregar (item=null) o editar un articulo de una persona.
 * @param {object} person
 * @param {object|null} item
 */
function openItemModal(person, item) {
  const isEdit = !!item;
  const form = el('form', 'inline-form');

  // Nombre
  const nameInput = el('input', 'input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Artículo (ej. Zapatillas)';
  nameInput.required = true;
  nameInput.maxLength = 120;
  nameInput.value = isEdit ? item.name : '';
  form.appendChild(nameInput);

  // Fila: cantidad + categoria
  const row = el('div', 'form-row');
  const qtyInput = el('input', 'input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.step = '1';
  qtyInput.placeholder = 'Cantidad';
  qtyInput.value = isEdit ? String(item.quantity || 1) : '1';
  row.appendChild(qtyInput);

  const catSelect = el('select', 'select-field');
  categoriesInUse().forEach((c) => {
    const opt = el('option', undefined, labelForCategory(c));
    opt.value = c;
    if (isEdit ? item.category === c : c === 'otros') opt.selected = true;
    catSelect.appendChild(opt);
  });
  row.appendChild(catSelect);
  form.appendChild(row);

  // Notas
  const notesInput = el('textarea', 'textarea');
  notesInput.placeholder = 'Notas (ej. talla 38, color azul)';
  notesInput.value = isEdit ? item.notes || '' : '';
  form.appendChild(notesInput);

  // Acciones
  const actions = el('div', 'form-actions');
  const saveBtn = el('button', 'btn btn-primary', isEdit ? 'Guardar' : 'Agregar');
  saveBtn.type = 'submit';
  const cancelBtn = el('button', 'btn btn-ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const data = {
      name,
      quantity: parseInt(qtyInput.value, 10) || 1,
      notes: notesInput.value,
      category: catSelect.value || 'otros',
    };
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        await updateItem(item.id, data);
        Object.assign(item, {
          name: data.name,
          quantity: data.quantity,
          notes: data.notes.trim(),
          category: data.category,
        });
      } else {
        await addItem(person.id, data);
        await reloadAndRender();
      }
      render();
      closeModal();
    } catch (err) {
      saveBtn.disabled = false;
      showError(isEdit ? 'No se pudo actualizar el artículo.' : 'No se pudo agregar el artículo.');
    }
  });

  openModal(
    isEdit ? 'Editar artículo' : `Agregar artículo a ${person.name}`,
    form
  );
}

// -----------------------------------------------------------------------------
// 15. Conexion de la barra de busqueda y filtros
// -----------------------------------------------------------------------------

/**
 * Conecta los controles de busqueda / filtros al estado y re-render.
 */
function initToolbar() {
  const search = document.getElementById('search-input');
  if (search) {
    search.addEventListener('input', () => {
      filters.search = search.value.trim();
      render();
    });
  }

  const pendingBtn = document.getElementById('filter-pending');
  if (pendingBtn) {
    pendingBtn.addEventListener('click', () => {
      filters.onlyPending = !filters.onlyPending;
      pendingBtn.setAttribute('aria-pressed', String(filters.onlyPending));
      pendingBtn.classList.toggle('is-active', filters.onlyPending);
      render();
    });
  }

  const catSelect = document.getElementById('filter-category');
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      filters.category = catSelect.value;
      render();
    });
  }

  const addPersonBtn = document.getElementById('add-person');
  if (addPersonBtn) {
    addPersonBtn.addEventListener('click', () => openPersonModal(null));
  }
}

// -----------------------------------------------------------------------------
// 16. Arranque
// -----------------------------------------------------------------------------

/**
 * Punto de arranque de la app.
 */
async function init() {
  initTheme();
  initToolbar();

  if (!supabase) {
    // Sin cliente valido no hay nada que cargar; el aviso ya se mostro.
    return;
  }

  setLoading(true);
  try {
    await reloadAndRender();
    subscribeRealtime();
  } catch (e) {
    showError('No se pudo cargar la lista desde Supabase.');
  } finally {
    setLoading(false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
