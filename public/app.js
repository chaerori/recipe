const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요');
  return j;
};
let toastTimer;
// undo를 넘기면 "실행 취소" 버튼이 함께 잠깐 보입니다.
const toast = (m, undo) => {
  const t = $('#toast'); ($('#modal').open ? $('#modal') : document.body).appendChild(t);
  t.textContent = m; t.classList.toggle('act', !!undo);
  if (undo) {
    const b = document.createElement('button');
    b.className = 'undo'; b.textContent = '실행 취소';
    b.onclick = guard(async () => { t.classList.remove('show'); await undo(); toast('되돌렸어요'); });
    t.append(b);
  }
  t.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 2200);
};
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// 앱 아이콘과 같은 결의 둥근 선 아이콘
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON_EDIT = svg('M4.5 19.5l.9-4.1L16.2 4.6a2.1 2.1 0 0 1 3 3L8.6 18.6l-4.1.9zM14.5 6.3l3.2 3.2');
const ICON_DEL = svg('M6 6l12 12M18 6L6 18');

// ---------- 탭 ----------
const views = { fridge: renderFridge, suggest: renderSuggest, log: renderLog, shop: renderShop, settings: renderSettings };
function show(tab) {
  window.scrollTo(0, 0);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  Object.keys(views).forEach((k) => ($('#' + k).hidden = k !== tab));
  guard(views[tab])();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); });

// ---------- 냉장고 ----------
// 브라우저 기본 날짜 입력창의 "연도. 월. 일." 대신 "소비기한" 안내 문구를 보여 줍니다.
// 단위: 목록에서 고르거나 "직접 입력"으로 자유롭게 씁니다. 실제 값은 name="unit" 입력창이 가집니다.
const UNITS = ['개', 'g', 'kg', 'ml', 'L', '봉지', '팩', '병', '캔', '단', '모', '마리', '장', '조각', '줄', '포기', '알', '통', '컵', '큰술', '작은술'];
const unitField = (v = '개') => {
  const custom = !UNITS.includes(v);
  return `<span class="unitfield"><select class="unitsel" aria-label="단위" ${custom ? 'hidden' : ''}>
      <option value="__custom">직접 입력</option>${UNITS.map((u) => `<option ${u === v ? 'selected' : ''}>${u}</option>`).join('')}</select>
    <input name="unit" class="unitin" value="${esc(v)}" placeholder="단위" aria-label="단위" ${custom ? '' : 'hidden'}></span>`;
};
document.addEventListener('change', (e) => {
  if (!e.target.matches('.unitsel')) return;
  const inp = e.target.nextElementSibling;
  if (e.target.value === '__custom') { e.target.hidden = true; inp.hidden = false; inp.value = ''; inp.focus(); } else inp.value = e.target.value;
});
document.addEventListener('focusout', (e) => {
  if (!e.target.matches('.unitin') || e.target.value.trim()) return;
  const sel = e.target.previousElementSibling;
  e.target.hidden = true; sel.hidden = false; sel.value = '개'; e.target.value = '개';
});
// est: 일반 보관 기간으로 예상해 채운 값인지. 사용자가 날짜를 직접 고치면 0으로 바뀝니다.
const dateField = (v, est = 0) => `<label class="datefield"><input name="expiry" type="date" value="${v}" class="${v ? 'filled' : ''}" aria-label="소비기한"><span>소비기한</span><input type="hidden" name="est" value="${est ? 1 : 0}"></label>`;
document.addEventListener('input', (e) => {
  if (!e.target.matches('.datefield input[type=date]')) return;
  e.target.classList.toggle('filled', !!e.target.value);
  e.target.nextElementSibling.nextElementSibling.value = 0; // 직접 입력한 날짜
  e.target.dataset.manual = e.target.value ? '1' : '';
});

// 이름·보관 위치를 정하면 소비기한을 일반 보관 기간으로 미리 채워 줍니다. 직접 고친 날짜는 건드리지 않습니다.
async function prefillExpiry() {
  const f = $('#addForm'); if (!f) return;
  const d = f.querySelector('input[type=date]'), est = f.querySelector('input[name=est]');
  if (d.dataset.manual === '1') return;
  const name = f.name.value.trim(); if (!name) return;
  const r = await api(`/api/shelf-life?name=${encodeURIComponent(name)}&storage=${encodeURIComponent(f.storage.value)}`);
  d.value = r.expiry || ''; d.classList.toggle('filled', !!r.expiry); est.value = r.expiry ? 1 : 0;
}
document.addEventListener('change', (e) => { if (e.target.matches('#addForm [name=name], #addForm [name=storage]')) guard(prefillExpiry)(); });

const tone = (d) => d === null ? '' : d < 0 ? 'bad' : d <= 3 ? 'warn' : 'ok';
const dBadge = (d) => d === null ? '<span class="badge plain">기한 없음</span>'
  : d < 0 ? `<span class="badge bad">${-d}일 지남</span>`
  : d === 0 ? '<span class="badge bad">오늘까지</span>'
  : d <= 3 ? `<span class="badge warn">D-${d}</span>` : `<span class="badge ok">D-${d}</span>`;

async function renderFridge() {
  const items = await api('/api/ingredients');
  const soon = items.filter((i) => i.daysLeft !== null && i.daysLeft <= 3);
  $('#fridge').innerHTML = `
    <form id="addForm" class="card addform">
      <input class="full" name="name" placeholder="재료 이름 (다른 이름은 쉼표로)" required aria-label="재료 이름">
      <input name="qty" type="number" inputmode="decimal" step="any" min="0" value="1" aria-label="수량">
      ${unitField()}
      <select name="storage" aria-label="보관 위치"><option>냉장</option><option>냉동</option><option>실온</option></select>
      ${dateField('')}
      <button class="btn primary">재료 추가</button>
    </form>
    ${soon.length ? `<div class="notice"><span>⏰</span><span><b>소비기한을 확인해 주세요 (${soon.length}개)</b><br>${soon.map((i) => esc(i.name)).join(', ')}</span></div>` : ''}
    <div class="list">${items.length ? items.map((i) => `
      <div class="card item ${tone(i.daysLeft)}" data-id="${i.id}">
        <div class="grow"><span class="name">${esc(i.name)}</span>
          <div class="muted">${esc(i.storage)} · ${i.qty}${esc(i.unit)}${i.expiry ? ' · ' + i.expiry + (i.expiry_est ? ' (예상)' : '') : ''}</div></div>
        ${dBadge(i.daysLeft)}
        <button class="iconbtn" data-act="edit" aria-label="수정">${ICON_EDIT}</button>
        <button class="iconbtn danger" data-act="del" aria-label="삭제">${ICON_DEL}</button>
      </div>`).join('') : '<div class="empty">냉장고가 비어 있어요.<br>위에서 재료를 추가하면 만들 수 있는 요리를 찾아 드려요.</div>'}</div>`;

  $('#addForm').onsubmit = guard(async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await api('/api/ingredients', 'POST', f);
    renderFridge();
  });
  $('#fridge .list').onclick = guard(async (e) => {
    const act = e.target.dataset.act; if (!act) return;
    const id = e.target.closest('.item').dataset.id;
    const it = items.find((i) => i.id == id);
    if (act === 'del') {
      await api('/api/ingredients/' + id, 'DELETE'); renderFridge();
      toast(`${it.name} 삭제했어요`, async () => { await api('/api/ingredients', 'POST', it); renderFridge(); });
    }
    if (act === 'edit') editIngredient(it);
  });
}

function editIngredient(it) {
  openModal(`<h2 style="margin-top:0">재료 수정</h2>
    <form id="editForm" class="addform">
      <input class="full" name="name" value="${esc(it.name)}" required>
      <input name="qty" type="number" inputmode="decimal" step="any" min="0" value="${it.qty}">
      ${unitField(it.unit)}
      <select name="storage">${['냉장', '냉동', '실온'].map((s) => `<option ${s === it.storage ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${dateField(it.expiry || '', it.expiry_est)}
      <button class="btn primary">저장</button>
    </form>`);
  $('#editForm').onsubmit = guard(async (e) => {
    e.preventDefault();
    await api('/api/ingredients/' + it.id, 'PUT', Object.fromEntries(new FormData(e.target)));
    $('#modal').close(); renderFridge();
  });
}

// ---------- 레시피 추천 ----------
let sel = { category: '전체', maxMissing: 99, servings: '', maxMinutes: '', q: '' };

async function renderSuggest() {
  const [cats, stats] = await Promise.all([api('/api/categories'), api('/api/recipes/stats')]);
  const total = Object.values(stats.byCategory).reduce((a, b) => a + b, 0);
  const all = ['전체', ...cats];
  $('#suggest').innerHTML = `
    <div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>
      <input id="q" type="search" value="${esc(sel.q)}" placeholder="요리나 재료로 검색" aria-label="요리 검색" enterkeyhint="search" autocomplete="off"></div>
    <div class="cats">${all.map((c) => `<button data-cat="${c}" class="${sel.category === c ? 'on' : ''}">${c}
      <small>${c === '전체' ? total : stats.byCategory[c] || 0}개</small></button>`).join('')}</div>
    <div id="results"></div>`;
  if (!total) { $('#results').innerHTML = '<div class="empty">저장된 레시피가 없어요.<br>설정에서 레시피를 먼저 가져와 주세요.</div>'; return; }
  let t;
  $('#q').oninput = (e) => { sel.q = e.target.value; clearTimeout(t); t = setTimeout(guard(loadResults), 250); };
  $('#suggest .cats').onclick = guard(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sel.category = b.dataset.cat; renderSuggest();
  });
  if (sel.category) await loadResults();
}

async function loadResults() {
  const list = await api(`/api/recommend?category=${encodeURIComponent(sel.category)}&maxMissing=${sel.maxMissing}&servings=${sel.servings}&maxMinutes=${sel.maxMinutes}&q=${encodeURIComponent(sel.q.trim())}`);
  const ready = list.filter((r) => r.missing.length === 0).length;
  $('#results').innerHTML = `
    <div class="filters">
      <select id="mm" aria-label="부족 재료"><option value="99">부족 재료 무관</option>
        ${[0, 1, 2, 3].map((n) => `<option value="${n}" ${sel.maxMissing === n ? 'selected' : ''}>부족 ${n}개 이하</option>`).join('')}</select>
      <select id="sv"><option value="">인분 무관</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${sel.servings == n ? 'selected' : ''}>${n}인분 안팎</option>`).join('')}</select>
      <select id="mt"><option value="">시간 무관</option>${[15, 30, 60, 90].map((n) => `<option value="${n}" ${sel.maxMinutes == n ? 'selected' : ''}>${n}분 이내</option>`).join('')}</select></div>
    <p class="summary">바로 만들 수 있는 요리 <b>${ready}개</b> · 전체 ${list.length}개</p>
    <div class="recipes">${list.length ? list.map(recipeCard).join('') : `<div class="empty" style="grid-column:1/-1">${sel.q.trim() ? `“${esc(sel.q.trim())}”에 맞는 레시피가 없어요.<br>다른 단어로 검색하거나 종류를 “전체”로 바꿔 보세요.` : '조건에 맞는 레시피가 없어요.<br>냉장고에 재료를 더 추가하거나 필터를 넓혀 보세요.'}</div>`}</div>`;
  $('#mm').onchange = guard(async (e) => { sel.maxMissing = Number(e.target.value); await loadResults(); });
  $('#sv').onchange = guard(async (e) => { sel.servings = e.target.value; await loadResults(); });
  $('#mt').onchange = guard(async (e) => { sel.maxMinutes = e.target.value; await loadResults(); });
  $('.recipes').onclick = guard(async (e) => { const c = e.target.closest('.recipe'); if (c) openRecipe(c.dataset.id); });
}

const recipeCard = (r) => `
  <div class="card recipe" data-id="${r.id}">
    ${r.image ? `<img src="${esc(r.image)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}
    <div class="body">
      <h3>${esc(r.title)}</h3>
      <div class="muted">★ ${r.rating} (${r.reviewCount}) ${r.time ? '· ' + esc(r.time) : ''} ${r.cookCount ? `· 🍽 ${r.cookCount}회` : ''}</div>
      <div class="meter ${r.missing.length === 0 ? 'full' : 'part'}"><i style="width:${Math.round(r.coverage * 100)}%"></i></div>
      <div class="meterlabel">
        <span>${r.missing.length === 0 ? '지금 바로 만들 수 있어요' : `재료 ${r.have.length}/${r.have.length + r.missing.length}개 보유`}</span>
        ${r.soon.length ? `<span class="badge warn">임박 재료 ${r.soon.length}개 사용</span>` : ''}
      </div>
      <div style="margin-top:4px">${r.have.map((n) => `<span class="pill have">${esc(n)}</span>`).join('')}${r.missing.map((n) => `<span class="pill miss">${esc(n)}</span>`).join('')}</div>
    </div>
  </div>`;

async function openRecipe(id) {
  const r = await api('/api/recipes/' + id);
  openModal(`
    ${r.image ? `<img class="hero" src="${esc(r.image)}" referrerpolicy="no-referrer" alt="">` : ''}
    <h2>${esc(r.title)}</h2>
    <p class="muted">★ ${r.rating} (${r.review_count}) ${r.time ? '· ' + esc(r.time) : ''} ${r.servings ? '· ' + esc(r.servings) : ''} ·
      <a href="${r.url}" target="_blank" rel="noopener">만개의레시피 원문</a></p>
    <p>${esc(r.description)}</p>
    <h3>재료</h3>
    <div>${r.items.map((i) => `<span class="pill ${i.status === 'miss' ? 'miss' : i.status === 'have' ? 'have' : ''}">${esc(i.text)}</span>`).join('')}
    <p class="muted">초록은 보유, 빨강은 부족, 회색은 기본 재료예요.</p></div>
    <h3>조리 순서</h3>
    ${r.steps.length ? `<ol class="steps">${r.steps.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol>` : '<p class="muted">조리 순서는 원문 링크에서 확인해 주세요.</p>'}
    `, `${r.missing.length ? `<button class="btn" id="toShop">부족한 재료 담기 (${r.missing.length})</button>` : ''}<button class="btn primary" id="cooked">만들었어요</button>`);
  if (r.missing.length) $('#toShop').onclick = guard(async () => { await api('/api/shopping', 'POST', { names: r.missing });
    const b = $('#toShop'); b.textContent = `✓ ${r.missing.length}개 담았어요`; b.disabled = true;
    toast('장보기 목록에 담았어요'); });
  $('#cooked').onclick = () => openCooked(r);
}

function openCooked(r) {
  openModal(`<h2 style="margin-top:0">요리 기록</h2><p><b>${esc(r.title)}</b></p>
    ${r.pantryUsed.length ? `<p class="muted">쓴 재료는 냉장고 수량에서 1씩 빼요. 쓰지 않은 재료는 체크를 풀어 주세요.</p>
      ${r.pantryUsed.map((u) => `<label class="chk"><input type="checkbox" value="${u.id}" checked> ${esc(u.name)} <span class="muted">(현재 ${u.qty}${esc(u.unit)})</span></label>`).join('')}`
      : '<p class="muted">냉장고에서 뺄 재료가 없어요.</p>'}
    <textarea id="note" rows="2" style="width:100%;margin-top:10px" placeholder="메모 (선택)"></textarea>`, '<button class="btn primary" id="save">기록하기</button>');
  $('#save').onclick = guard(async () => {
    const deductIds = [...document.querySelectorAll('#modal input[type=checkbox]:checked')].map((c) => Number(c.value));
    await api('/api/cook', 'POST', { recipeId: r.id, note: $('#note').value, deductIds });
    $('#modal').close(); toast('기록했어요 🍽'); if (sel.category) loadResults().catch(() => {});
  });
}

// ---------- 요리 기록 ----------
async function renderLog() {
  const { stats, history } = await api('/api/cook-log');
  $('#log').innerHTML = !stats.length ? '<div class="empty">아직 기록한 요리가 없어요.<br>추천 탭에서 레시피를 열고 “만들었어요”를 눌러 보세요.</div>' : `
    <h2 style="margin-top:4px">많이 만든 요리</h2>
    <div class="list">${stats.map((s) => `<div class="card item tap" data-id="${s.id}">
      <div class="grow"><span class="name">${esc(s.title)}</span><div class="muted">마지막 ${s.last.slice(0, 10)} · ★ ${s.rating}</div></div>
      <span class="badge">${s.count}회</span></div>`).join('')}</div>
    <h2>최근 기록</h2>
    <div class="list">${history.map((h) => `<div class="card item"><div class="grow"><b>${esc(h.title)}</b>
      <div class="muted">${h.cooked_at.slice(0, 16)}${h.note ? ' · ' + esc(h.note) : ''}</div></div>
      <button class="iconbtn danger" data-del="${h.id}" aria-label="삭제">${ICON_DEL}</button></div>`).join('')}</div>`;
  $('#log').onclick = guard(async (e) => {
    if (e.target.dataset.del) {
      const h = history.find((x) => x.id == e.target.dataset.del);
      await api('/api/cook-log/' + h.id, 'DELETE'); renderLog();
      return toast('기록을 삭제했어요', async () => { await api('/api/cook-log/restore', 'POST', { recipeId: h.recipe_id, cookedAt: h.cooked_at, note: h.note }); renderLog(); });
    }
    const c = e.target.closest('[data-id]'); if (c) openRecipe(c.dataset.id);
  });
}

// ---------- 장보기 ----------
async function renderShop() {
  const items = await api('/api/shopping');
  $('#shop').innerHTML = `
    <form id="shopForm" class="card row" style="flex-wrap:nowrap"><input class="grow" name="name" placeholder="사야 할 재료" required aria-label="사야 할 재료"><button class="btn primary">추가</button></form>
    <div class="list">${items.length ? items.map((s) => `<div class="card item" data-id="${s.id}">
      <input type="checkbox" ${s.done ? 'checked' : ''}> <span class="grow ${s.done ? 'muted' : ''}" style="${s.done ? 'text-decoration:line-through' : ''}">${esc(s.name)}</span>
      <button class="iconbtn danger" data-del aria-label="삭제">${ICON_DEL}</button></div>`).join('') : '<div class="empty">장보기 목록이 비어 있어요.<br>추천 레시피에서 부족한 재료를 담아 보세요.</div>'}</div>
    ${items.some((s) => s.done) ? '<div class="row" style="margin-top:14px"><button class="btn primary grow" id="move">구매한 재료를 냉장고로 옮기기</button></div>' : ''}`;
  $('#shopForm').onsubmit = guard(async (e) => { e.preventDefault(); await api('/api/shopping', 'POST', { name: new FormData(e.target).get('name') }); renderShop(); });
  $('#shop .list').onclick = guard(async (e) => {
    const row = e.target.closest('.item'); if (!row) return;
    if (e.target.matches('[data-del]')) {
      const s = items.find((x) => x.id == row.dataset.id);
      await api('/api/shopping/' + s.id, 'DELETE'); renderShop();
      return toast(`${s.name} 목록에서 뺐어요`, async () => { await api('/api/shopping', 'POST', { name: s.name }); renderShop(); });
    }
    else if (e.target.type === 'checkbox') await api('/api/shopping/' + row.dataset.id, 'PATCH', { done: e.target.checked });
    else return;
    renderShop();
  });
  $('#move')?.addEventListener('click', guard(async () => { const r = await api('/api/shopping/move-done', 'POST'); toast(`${r.moved}개를 냉장고로 옮겼어요. 소비기한을 입력해 주세요`); renderShop(); }));
}

// ---------- 설정 ----------
let poll;
async function renderSettings() {
  const [cats, staples, stats, avoid] = await Promise.all([api('/api/categories'), api('/api/staples'), api('/api/recipes/stats'), api('/api/avoid')]);
  $('#settings').innerHTML = `
    <h2 style="margin-top:4px">레시피 가져오기</h2>
    <div class="card">
      <p class="muted">만개의레시피에서 별점 ${stats.minRating} 이상인 요리만 가져와요. 사이트에 부담을 주지 않도록 천천히 가져와서 시간이 걸려요. 개인 용도로만 사용해 주세요.</p>
      <div class="row" style="gap:4px 16px">${cats.map((c) => `<label class="chk"><input type="checkbox" name="c" value="${c}" checked> ${c} <span class="muted">(${stats.byCategory[c] || 0})</span></label>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        <label class="grow muted">종류별 페이지 수<input id="pages" type="number" inputmode="numeric" min="1" max="10" value="2" style="width:100%;display:block"></label>
        <label class="grow muted">최소 후기 수<input id="minRev" type="number" inputmode="numeric" min="0" value="3" style="width:100%;display:block"></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary grow" id="startCrawl">가져오기 시작</button><button class="btn" id="stopCrawl">중지</button>
      </div>
      <p id="crawlMsg" class="muted"></p>
    </div>
    <h2>못 먹는 재료</h2>
    <p class="muted">이 재료가 들어간 레시피는 추천에서 빼요. 알레르기나 싫어하는 재료를 등록해 두세요.</p>
    <div class="row" id="avoid">${avoid.map((s) => `<span class="pill miss">${esc(s)} <button class="link" data-a="${esc(s)}">×</button></span>`).join('') || '<span class="muted">등록된 재료가 없어요.</span>'}</div>
    <form id="avoidForm" class="row" style="margin-top:10px"><input name="name" placeholder="예: 땅콩" required><button class="btn">추가</button></form>
    <h2>기본 재료</h2>
    <p class="muted">늘 집에 있다고 보는 양념이에요. 부족한 재료로 세지 않아요.</p>
    <div class="row" id="staples">${staples.map((s) => `<span class="pill">${esc(s)} <button class="link" data-s="${esc(s)}">×</button></span>`).join('')}</div>
    <form id="stapleForm" class="row" style="margin-top:10px"><input name="name" placeholder="예: 매실청" required><button class="btn">추가</button></form>`;

  $('#startCrawl').onclick = guard(async () => {
    const categories = [...document.querySelectorAll('input[name=c]:checked')].map((c) => c.value);
    await api('/api/crawl', 'POST', { categories, pages: $('#pages').value, minReviews: $('#minRev').value });
    pollCrawl();
  });
  $('#stopCrawl').onclick = guard(() => api('/api/crawl/stop', 'POST'));
  $('#avoidForm').onsubmit = guard(async (e) => { e.preventDefault(); await api('/api/avoid', 'POST', { name: new FormData(e.target).get('name') }); renderSettings(); });
  $('#avoid').onclick = guard(async (e) => { if (e.target.dataset.a) { await api('/api/avoid/' + encodeURIComponent(e.target.dataset.a), 'DELETE'); renderSettings(); } });
  $('#stapleForm').onsubmit = guard(async (e) => { e.preventDefault(); await api('/api/staples', 'POST', { name: new FormData(e.target).get('name') }); renderSettings(); });
  $('#staples').onclick = guard(async (e) => { if (e.target.dataset.s) { await api('/api/staples/' + encodeURIComponent(e.target.dataset.s), 'DELETE'); renderSettings(); } });
  pollCrawl();
}

function pollCrawl() {
  clearInterval(poll);
  const tick = async () => {
    const msg = $('#crawlMsg'); if (!msg) return clearInterval(poll);
    const s = await api('/api/crawl/status');
    msg.textContent = `${s.running ? '⏳ ' : ''}${s.message} · ${s.saved}개 저장 · 실패 ${s.errors}건`;
    if (!s.running) clearInterval(poll);
  };
  tick(); poll = setInterval(tick, 1500);
}

function openModal(html, actions = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="grab"></div><div class="in">${html}<div class="foot">${actions}<button class="btn" id="closeM">닫기</button></div></div>`;
  $('#closeM').onclick = () => m.close();
  m.onclick = (e) => { if (e.target === m) m.close(); };
  if (!m.open) m.showModal();
}

show('fridge');
