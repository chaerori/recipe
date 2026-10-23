// 화면 코드가 호출하는 /api/... 주소를 브라우저 안에서 처리합니다. (서버 없이 동작)
import { store } from './store.js';
import { MIN_RATING, recommend, matchRecipe, usablePantry, aliases, daysLeft } from './matcher.js';
import { expiryFrom } from './shelf.js';

export const CATEGORIES = ['반찬', '메인요리', '국·찌개', '밥·면·만두', '간식·디저트', '샐러드'];
const MINE = '내 레시피';
const DEFAULT_STAPLES = ['소금', '설탕', '간장', '진간장', '국간장', '후추', '후춧가루', '식용유', '물', '참기름',
  '들기름', '통깨', '깨', '고춧가루', '다진마늘', '식초', '올리고당', '맛술', '미림', '고추장', '된장', '쌈장',
  '마요네즈', '케첩', '굴소스', '버터', '밀가루', '부침가루', '튀김가루', '전분', '녹말', '얼음', '청주', '다시마', '멸치'];

const need = (v, msg) => { if (!v) throw new Error(msg); return v; };
const nowText = () => new Date().toLocaleString('sv'); // 2026-10-22 13:05:09

// 레시피는 Supabase(로그인 필요)에서 읽습니다. 로컬 모드에서는 개발용 사본(data/recipes.json)이 있을 때만 쓰고, 없으면 내 레시피만 보입니다.
let recipesP;
const recipes = () => (recipesP ||= (store.recipes
  ? store.recipes()
  : fetch('data/recipes.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
).catch((e) => { recipesP = null; throw e; }));

// 내 레시피는 번호를 음수(-id)로 두어 만개의레시피 번호와 겹치지 않게 합니다.
const stepList = (steps) => (steps || []).map((s) => (typeof s === 'string' ? { text: s } : s));
const toMine = (r) => ({
  id: -r.id, mine: true, title: r.title, image: null, rating: 5, reviewCount: 0, category: r.category,
  time: r.time, servings: r.servings, ingredients: r.ingredients || [], description: r.description || '',
  steps: stepList(r.steps), sourceUrl: r.source_url || '',
});
const allRecipes = async () => [...(await recipes()), ...(await store.list('my_recipes')).map(toMine)];
const lines = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim()).filter(Boolean);
function mineRow(b) {
  need(b.title?.trim(), '제목을 입력해 주세요');
  const ingredients = lines(b.ingredients);
  need(ingredients.length, '재료를 한 개 이상 입력해 주세요');
  return {
    title: b.title.trim(), category: CATEGORIES.includes(b.category) ? b.category : '메인요리',
    time: Number(b.minutes) > 0 ? `${Number(b.minutes)}분` : null, servings: Number(b.servingsNum) > 0 ? `${Number(b.servingsNum)}인분` : null,
    description: (b.description || '').trim(), source_url: (b.source_url || '').trim(),
    ingredients, steps: lines((b.steps || []).map((s) => s?.text ?? s)).map((text) => ({ text })),
  };
}

async function staples() {
  let rows = await store.list('staples');
  if (!rows.length) { // 처음 쓸 때 기본 양념을 채워 둡니다.
    for (const name of DEFAULT_STAPLES) await store.insert('staples', { name });
    rows = await store.list('staples');
  }
  return rows;
}

// 소비기한이 비어 있으면 일반 보관 기간으로 예상해 채웁니다.
function resolveExpiry({ name = '', storage = '냉장', expiry, est, expiry_est }) {
  if (expiry) return { expiry, expiry_est: Number(est ?? expiry_est) ? 1 : 0 };
  const e = expiryFrom(name, storage);
  return e ? { expiry: e.expiry, expiry_est: 1 } : { expiry: null, expiry_est: 0 };
}

const byName = (t) => async (name) => (await store.list(t)).filter((r) => r.name === name);

const routes = {
  // ----- 재료 -----
  'GET /ingredients': async () => (await store.list('ingredients'))
    .sort((a, b) => (a.expiry ? 0 : 1) - (b.expiry ? 0 : 1) || (a.expiry || '').localeCompare(b.expiry || '') || a.name.localeCompare(b.name))
    .map((i) => ({ ...i, daysLeft: daysLeft(i.expiry) })),
  'POST /ingredients': async (_, b) => {
    need(b.name?.trim(), '재료 이름을 입력해 주세요');
    const row = await store.insert('ingredients', {
      name: b.name.trim(), qty: Number(b.qty) || 1, unit: b.unit || '개', storage: b.storage || '냉장',
      ...resolveExpiry(b), added_at: nowText().slice(0, 10),
    });
    return { id: row.id };
  },
  'PUT /ingredients/:id': async ({ id }, b) => {
    need(b.name?.trim(), '재료 이름을 입력해 주세요');
    await store.update('ingredients', Number(id), {
      name: b.name.trim(), qty: Number(b.qty) || 0, unit: b.unit || '개', storage: b.storage, ...resolveExpiry(b),
    });
  },
  'DELETE /ingredients/:id': async ({ id }) => store.remove('ingredients', Number(id)),
  'GET /shelf-life': async (_, __, q) => expiryFrom(q.get('name') || '', q.get('storage') || '냉장') || { days: null, expiry: null },

  // ----- 기본 재료 · 못 먹는 재료 -----
  'GET /staples': async () => (await staples()).map((r) => r.name).sort((a, b) => a.localeCompare(b)),
  'POST /staples': async (_, b) => { const n = need(b.name?.trim(), '이름을 입력해 주세요'); if (!(await byName('staples')(n)).length) await store.insert('staples', { name: n }); },
  'DELETE /staples/:name': async ({ name }) => { for (const r of await byName('staples')(name)) await store.remove('staples', r.id); },
  'GET /avoid': async () => (await store.list('avoid')).map((r) => r.name).sort((a, b) => a.localeCompare(b)),
  'POST /avoid': async (_, b) => { const n = need(b.name?.trim(), '이름을 입력해 주세요'); if (!(await byName('avoid')(n)).length) await store.insert('avoid', { name: n }); },
  'DELETE /avoid/:name': async ({ name }) => { for (const r of await byName('avoid')(name)) await store.remove('avoid', r.id); },

  // ----- 레시피 -----
  'GET /categories': async () => [...CATEGORIES, MINE],
  'GET /recommend': async (_, __, q) => {
    const [rs, ingredients, st, avoid, log] = await Promise.all([allRecipes(), store.list('ingredients'), staples(), store.list('avoid'), store.list('cook_log')]);
    const cookCounts = {};
    log.forEach((l) => { cookCounts[l.recipe_id] = (cookCounts[l.recipe_id] || 0) + 1; });
    return recommend({ recipes: rs, ingredients, staples: st.map((s) => s.name), avoid: avoid.map((a) => a.name), cookCounts }, q.get('category'), {
      maxMissing: q.get('maxMissing') === null ? 99 : Number(q.get('maxMissing')),
      servings: Number(q.get('servings')) || null, maxMinutes: Number(q.get('maxMinutes')) || null, q: q.get('q') || '',
    });
  },
  'GET /recipes/stats': async () => {
    const byCategory = {};
    (await allRecipes()).filter((r) => r.mine || r.rating >= MIN_RATING).forEach((r) => {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (r.mine) byCategory[MINE] = (byCategory[MINE] || 0) + 1;
    });
    return { byCategory, minRating: MIN_RATING };
  },
  'GET /recipes/:id': async ({ id }) => {
    const r = need((await allRecipes()).find((x) => x.id === Number(id)), '레시피를 찾지 못했어요');
    let { description, steps } = r;
    if (r.steps?.length) steps = stepList(r.steps); // 로컬 개발용 사본에는 조리 순서가 들어 있습니다.
    else if (!r.mine) { // 만개의레시피 레시피의 조리 순서는 로그인한 Supabase 에서만 읽습니다 (없으면 원문 링크로 안내).
      try { const d = await store.detail(r.id); if (d) { description = d.description || ''; steps = stepList(d.steps); } } catch { /* 상세가 없어도 계속 */ }
    }
    const m = matchRecipe(r, usablePantry(await store.list('ingredients')), (await staples()).flatMap((s) => aliases(s.name)));
    return {
      ...r, review_count: r.reviewCount, description: description || '', steps: steps || [],
      url: r.mine ? r.sourceUrl : `https://www.10000recipe.com/recipe/${r.id}`,
      have: m.have, missing: m.missing, items: m.items,
      pantryUsed: [...new Map(m.used.map((u) => [u.id, { id: u.id, name: u.name, qty: u.qty, unit: u.unit }])).values()],
    };
  },

  // ----- 내 레시피 -----
  'GET /my-recipes/:id': async ({ id }) => {
    const r = need((await store.list('my_recipes')).find((x) => x.id === Number(id)), '레시피를 찾지 못했어요');
    return { ...r, minutes: r.time?.match(/\d+/)?.[0] || '', servingsNum: r.servings?.match(/\d+/)?.[0] || '' };
  },
  'POST /my-recipes': async (_, b) => ({ id: (await store.insert('my_recipes', mineRow(b))).id }),
  'PUT /my-recipes/:id': async ({ id }, b) => store.update('my_recipes', Number(id), mineRow(b)),
  'DELETE /my-recipes/:id': async ({ id }) => store.remove('my_recipes', Number(id)),

  // ----- 요리 기록 -----
  'POST /cook': async (_, { recipeId, note = '', deductIds = [] }) => {
    need((await allRecipes()).some((r) => r.id === Number(recipeId)), '레시피를 찾지 못했어요');
    await store.insert('cook_log', { recipe_id: Number(recipeId), cooked_at: nowText(), note });
    const have = await store.list('ingredients');
    for (const id of deductIds) { // 수량 1 감소, 0 이하가 되면 삭제
      const row = have.find((i) => i.id === id);
      if (!row) continue;
      if (row.qty - 1 <= 0) await store.remove('ingredients', id); else await store.update('ingredients', id, { qty: row.qty - 1 });
    }
  },
  'GET /cook-log': async () => {
    const [rs, log] = await Promise.all([allRecipes(), store.list('cook_log')]);
    const rec = new Map(rs.map((r) => [r.id, r]));
    const valid = log.filter((l) => rec.has(l.recipe_id));
    const groups = new Map();
    valid.forEach((l) => {
      const g = groups.get(l.recipe_id) || { id: l.recipe_id, count: 0, last: '' };
      g.count += 1; if (l.cooked_at > g.last) g.last = l.cooked_at; groups.set(l.recipe_id, g);
    });
    return {
      stats: [...groups.values()].map((g) => ({ ...g, title: rec.get(g.id).title, image: rec.get(g.id).image, rating: rec.get(g.id).rating, mine: g.id < 0 }))
        .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)),
      history: valid.sort((a, b) => b.cooked_at.localeCompare(a.cooked_at)).slice(0, 100)
        .map((l) => ({ id: l.id, cooked_at: l.cooked_at, note: l.note, recipe_id: l.recipe_id, title: rec.get(l.recipe_id).title })),
    };
  },
  'POST /cook-log/restore': async (_, { recipeId, cookedAt, note = '' }) => { await store.insert('cook_log', { recipe_id: Number(recipeId), cooked_at: cookedAt, note }); },
  'DELETE /cook-log/:id': async ({ id }) => store.remove('cook_log', Number(id)),

  // ----- 장보기 -----
  'GET /shopping': async () => (await store.list('shopping')).map((s) => ({ ...s, done: s.done ? 1 : 0 })).sort((a, b) => a.done - b.done || a.id - b.id),
  'POST /shopping': async (_, b) => {
    const have = new Set((await store.list('shopping')).map((s) => s.name));
    for (const n of [].concat(b.names ?? b.name ?? []).map((x) => String(x).trim()).filter(Boolean)) {
      if (!have.has(n)) { have.add(n); await store.insert('shopping', { name: n, done: false }); }
    }
  },
  'PATCH /shopping/:id': async ({ id }, b) => store.update('shopping', Number(id), { done: !!b.done }),
  'DELETE /shopping/:id': async ({ id }) => store.remove('shopping', Number(id)),
  // 구매 완료 항목을 냉장고 재료로 옮깁니다.
  'POST /shopping/move-done': async () => {
    const done = (await store.list('shopping')).filter((s) => s.done);
    for (const s of done) {
      await store.insert('ingredients', { name: s.name, qty: 1, unit: '개', storage: '냉장', ...resolveExpiry({ name: s.name, storage: '냉장' }), added_at: nowText().slice(0, 10) });
      await store.remove('shopping', s.id);
    }
    return { moved: done.length };
  },
};

// '/api/...' 주소를 routes 키와 맞춰 봅니다.
const compiled = Object.entries(routes).map(([key, fn]) => {
  const [method, path] = key.split(' ');
  const names = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
  return { method, re, names, fn };
});

export async function api(url, method = 'GET', body) {
  const u = new URL(url, location.origin);
  const path = u.pathname.replace(/^\/api/, '');
  for (const r of compiled) {
    const m = r.method === method && path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return (await r.fn(params, body || {}, u.searchParams)) ?? { ok: true };
  }
  throw new Error('알 수 없는 요청이에요');
}
