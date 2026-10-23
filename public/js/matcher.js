// 추천 계산 (브라우저에서 실행). 데이터는 인자로 받습니다.
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
export const aliases = (s) => String(s).split(SPLIT).map(norm).filter(Boolean);
const firstName = (s) => String(s).split(SPLIT)[0].trim();

const same = (a, b) => a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)));

export const today = () => new Date().toLocaleDateString('sv');
export const daysLeft = (expiry) => (expiry ? Math.round((new Date(expiry) - new Date(today())) / 86400000) : null);

// 소비기한이 지나지 않은 재료만 매칭 대상으로 봅니다.
export const usablePantry = (ingredients) => ingredients.filter((i) => {
  if (!(i.qty > 0)) return false;
  const d = daysLeft(i.expiry);
  return d === null || d >= 0;
});

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

// ctx: { recipes, ingredients, staples(이름 배열), avoid(이름 배열), cookCounts({id:횟수}) }
// opts: { maxMissing, servings(±1 허용), maxMinutes, q } — 정보가 없는 레시피는 걸러내지 않습니다.
export function recommend(ctx, category, opts = {}) {
  const { maxMissing = 99, servings = null, maxMinutes = null, q = '' } = opts;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const avoid = ctx.avoid.flatMap(aliases);
  const staples = ctx.staples.flatMap(aliases);
  const pantry = usablePantry(ctx.ingredients);
  const inCategory = (r) => !category || category === '전체' || (category === '내 레시피' ? !!r.mine : r.category === category);
  const rows = ctx.recipes.filter((r) => (r.mine || r.rating >= MIN_RATING) && inCategory(r));

  const list = rows.map((r) => {
    // 검색어: 모든 단어가 제목이나 재료에 들어 있어야 합니다.
    if (tokens.length) {
      const hay = (r.title + ' ' + r.ingredients.join(' ')).toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
    }
    const mins = minutesOf(r.time), serv = servingsOf(r.servings);
    if (maxMinutes && mins !== null && mins > maxMinutes) return null;
    if (servings && serv !== null && Math.abs(serv - servings) > 1) return null;
    if (r.ingredients.some((n) => avoid.some((a) => same(norm(n), a)))) return null;
    const m = matchRecipe(r, pantry, staples);
    return {
      id: r.id, title: r.title, image: r.image, rating: r.rating, reviewCount: r.reviewCount,
      category: r.category, time: r.time, servings: r.servings,
      url: r.mine ? r.sourceUrl : `https://www.10000recipe.com/recipe/${r.id}`, mine: !!r.mine,
      have: m.have, missing: m.missing, soon: m.soon,
      coverage: m.required.length ? m.have.length / m.required.length : 1, cookCount: ctx.cookCounts[r.id] || 0,
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
