import { db } from './db.js';

export const MIN_RATING = 4.9;
const SOON_DAYS = 3;

const ALIAS = { 달걀: '계란', 파: '대파', 마늘: '다진마늘' };

// "감자 2개", "물 1/4종이컵", "대파 약간" 같은 문자열에서 수량 표현을 제거합니다.
export const clean = (s) => String(s).replace(/\(.*?\)/g, '').replace(/[\d½¼¾⅓].*$/, '')
  .replace(/\s*(약간|조금|적당량|적당히|한줌|한꼭지|많이|넉넉히|듬뿍)\s*$/, '').trim();

export const norm = (s) => {
  const n = clean(s).replace(/\(.*?\)/g, '').replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
  return ALIAS[n] && n.length < 2 ? ALIAS[n] : n.replace(/달걀/g, '계란');
};

// "스파게티면, 파스타면"처럼 쉼표로 구분한 여러 이름은 모두 같은 재료로 봅니다.
const SPLIT = /[,，、]/;
const aliases = (s) => String(s).split(SPLIT).map(norm).filter(Boolean);
const firstName = (s) => String(s).split(SPLIT)[0].trim();

const same = (a, b) => a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)));

export const today = () => new Date().toLocaleDateString('sv');
export const daysLeft = (expiry) => (expiry ? Math.round((new Date(expiry) - new Date(today())) / 86400000) : null);

export function loadStaples() {
  return db.prepare('SELECT name FROM staples').all().flatMap((r) => aliases(r.name));
}

// 유통기한이 지나지 않은 재료만 매칭 대상으로 봅니다.
export function usablePantry() {
  return db.prepare('SELECT * FROM ingredients WHERE qty > 0').all()
    .filter((i) => { const d = daysLeft(i.expiry); return d === null || d >= 0; });
}

export function matchRecipe(recipe, pantry, staples) {
  const required = recipe.ingredients.filter((n) => { const k = norm(n); return k && !staples.some((s) => same(k, s)); });
  const have = [], missing = [], soon = [], used = [];
  const requiredSet = new Set(required);
  const items = recipe.ingredients.map((text) => ({ text, status: requiredSet.has(text) ? 'miss' : 'staple' }));
  for (const text of required) {
    const name = clean(text);
    const k = norm(text);
    const hit = pantry.find((p) => aliases(p.name).some((a) => same(k, a)));
    items.find((i) => i.text === text).status = hit ? 'have' : 'miss';
    if (hit) {
      have.push(name); used.push(hit);
      const d = daysLeft(hit.expiry);
      if (d !== null && d <= SOON_DAYS) soon.push({ name: firstName(hit.name), days: d });
    } else missing.push(name);
  }
  return { required, have, missing, soon, used, items };
}

const minutesOf = (t) => {
  if (!t) return null;
  const h = t.match(/(\d+)\s*시간/), m = t.match(/(\d+)\s*분/);
  return h || m ? (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) : null;
};
const servingsOf = (s) => (s && s.match(/\d+/) ? +s.match(/\d+/)[0] : null);

// opts: { maxMissing, servings(±1 허용), maxMinutes } — 정보가 없는 레시피는 걸러내지 않습니다.
export function recommend(category, opts = {}) {
  const { maxMissing = 99, servings = null, maxMinutes = null, q = '' } = opts;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const avoid = db.prepare('SELECT name FROM avoid').all().flatMap((r) => aliases(r.name));
  const pantry = usablePantry();
  const staples = loadStaples();
  const rows = category && category !== '전체'
    ? db.prepare('SELECT * FROM recipes WHERE rating >= ? AND category = ?').all(MIN_RATING, category)
    : db.prepare('SELECT * FROM recipes WHERE rating >= ?').all(MIN_RATING);
  const counts = Object.fromEntries(db.prepare('SELECT recipe_id, COUNT(*) c FROM cook_log GROUP BY recipe_id').all().map((r) => [r.recipe_id, r.c]));

  const list = rows.map((r) => {
    const recipe = { ...r, ingredients: JSON.parse(r.ingredients), steps: JSON.parse(r.steps) };
    // 검색어: 모든 단어가 제목이나 재료에 들어 있어야 합니다.
    if (tokens.length) {
      const hay = (r.title + ' ' + recipe.ingredients.join(' ')).toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
    }
    const mins = minutesOf(r.time), serv = servingsOf(r.servings);
    if (maxMinutes && mins !== null && mins > maxMinutes) return null;
    if (servings && serv !== null && Math.abs(serv - servings) > 1) return null;
    const avoided = recipe.ingredients.filter((n) => avoid.some((a) => same(norm(n), a)));
    if (avoided.length) return null;
    const m = matchRecipe(recipe, pantry, staples);
    const total = m.required.length || 1;
    return {
      id: r.id, title: r.title, image: r.image, rating: r.rating, reviewCount: r.review_count,
      category: r.category, time: r.time, servings: r.servings,
      url: `https://www.10000recipe.com/recipe/${r.id}`,
      have: m.have, missing: m.missing, soon: m.soon,
      coverage: m.required.length ? m.have.length / m.required.length : 1, cookCount: counts[r.id] || 0,
    };
  }).filter(Boolean).filter((r) => r.missing.length <= maxMissing);

  // 1) 만들 수 있는 것 우선 2) 임박 재료 사용 3) 보유 비율 4) 별점
  list.sort((a, b) =>
    (a.missing.length === 0 ? 0 : 1) - (b.missing.length === 0 ? 0 : 1)
    || b.soon.length - a.soon.length
    || b.coverage - a.coverage
    || b.rating - a.rating
    || b.reviewCount - a.reviewCount);
  return list;
}
