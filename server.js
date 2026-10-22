import express from 'express';
import { db } from './db.js';
import { crawl, status as crawlStatus, CATEGORIES } from './crawler.js';
import { expiryFrom } from './shelf.js';
import { recommend, matchRecipe, usablePantry, loadStaples, daysLeft, MIN_RATING } from './matcher.js';

const app = express();
app.use(express.json());
app.use(express.static(new URL('./public', import.meta.url).pathname));

const wrap = (fn) => (req, res) => { try { res.json(fn(req) ?? { ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } };
const need = (v, msg) => { if (!v) throw new Error(msg); return v; };

// ---------- 재료(냉장고) ----------
// 소비기한이 비어 있으면 일반 보관 기간으로 예상해 채웁니다. 날짜가 있으면 est 값(예상 여부)을 그대로 따릅니다.
function resolveExpiry({ name = '', storage = '냉장', expiry, est, expiry_est }) {
  if (expiry) return { expiry, est: Number(est ?? expiry_est) ? 1 : 0 };
  const e = expiryFrom(name, storage);
  return e ? { expiry: e.expiry, est: 1 } : { expiry: null, est: 0 };
}

app.get('/api/shelf-life', wrap((req) => expiryFrom(req.query.name || '', req.query.storage || '냉장') || { days: null, expiry: null }));

app.get('/api/ingredients', wrap(() =>
  db.prepare("SELECT * FROM ingredients ORDER BY expiry IS NULL, expiry, name").all()
    .map((i) => ({ ...i, daysLeft: daysLeft(i.expiry) }))));

app.post('/api/ingredients', wrap((req) => {
  const { name, qty = 1, unit = '개', storage = '냉장' } = req.body;
  need(name?.trim(), '재료 이름을 입력해 주세요');
  const { expiry, est } = resolveExpiry(req.body);
  const r = db.prepare('INSERT INTO ingredients(name,qty,unit,storage,expiry,expiry_est) VALUES (?,?,?,?,?,?)')
    .run(name.trim(), Number(qty) || 1, unit || '개', storage, expiry, est);
  return { id: Number(r.lastInsertRowid) };
}));

app.put('/api/ingredients/:id', wrap((req) => {
  const { name, qty, unit, storage } = req.body;
  const { expiry, est } = resolveExpiry(req.body);
  db.prepare('UPDATE ingredients SET name=?, qty=?, unit=?, storage=?, expiry=?, expiry_est=? WHERE id=?')
    .run(need(name?.trim(), '재료 이름을 입력해 주세요'), Number(qty) || 0, unit || '개', storage, expiry, est, req.params.id);
}));

app.delete('/api/ingredients/:id', wrap((req) => { db.prepare('DELETE FROM ingredients WHERE id=?').run(req.params.id); }));

// ---------- 기본 재료 ----------
app.get('/api/staples', wrap(() => db.prepare('SELECT name FROM staples ORDER BY name').all().map((r) => r.name)));
app.post('/api/staples', wrap((req) => { db.prepare('INSERT OR IGNORE INTO staples(name) VALUES (?)').run(need(req.body.name?.trim(), '이름을 입력해 주세요')); }));
app.delete('/api/staples/:name', wrap((req) => { db.prepare('DELETE FROM staples WHERE name=?').run(req.params.name); }));

// ---------- 못 먹는 재료 ----------
app.get('/api/avoid', wrap(() => db.prepare('SELECT name FROM avoid ORDER BY name').all().map((r) => r.name)));
app.post('/api/avoid', wrap((req) => { db.prepare('INSERT OR IGNORE INTO avoid(name) VALUES (?)').run(need(req.body.name?.trim(), '이름을 입력해 주세요')); }));
app.delete('/api/avoid/:name', wrap((req) => { db.prepare('DELETE FROM avoid WHERE name=?').run(req.params.name); }));

// ---------- 레시피 ----------
app.get('/api/categories', wrap(() => Object.keys(CATEGORIES)));

app.get('/api/recommend', wrap((req) => {
  const q = req.query;
  return recommend(q.category, {
    maxMissing: q.maxMissing === undefined ? 99 : Number(q.maxMissing),
    servings: Number(q.servings) || null, maxMinutes: Number(q.maxMinutes) || null, q: String(q.q || ''),
  });
}));

app.get('/api/recipes/stats', wrap(() => {
  const rows = db.prepare('SELECT category, COUNT(*) c FROM recipes WHERE rating >= ? GROUP BY category').all(MIN_RATING);
  return { byCategory: Object.fromEntries(rows.map((r) => [r.category, r.c])), minRating: MIN_RATING };
}));

app.get('/api/recipes/:id', wrap((req) => {
  const r = need(db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id), '레시피를 찾지 못했어요');
  const recipe = { ...r, ingredients: JSON.parse(r.ingredients), steps: JSON.parse(r.steps) };
  const m = matchRecipe(recipe, usablePantry(), loadStaples());
  return {
    ...recipe, url: `https://www.10000recipe.com/recipe/${r.id}`,
    have: m.have, missing: m.missing, items: m.items,
    pantryUsed: [...new Map(m.used.map((u) => [u.id, { id: u.id, name: u.name, qty: u.qty, unit: u.unit }])).values()],
  };
}));

// ---------- 수집 ----------
app.post('/api/crawl', wrap((req) => {
  const { categories = Object.keys(CATEGORIES), pages = 2, minReviews = 3 } = req.body;
  crawl({ categories, pages: Math.min(Number(pages) || 1, 10), minReviews: Number(minReviews) || 0, minRating: MIN_RATING })
    .catch((e) => { crawlStatus.message = `오류: ${e.message}`; });
  return { started: true };
}));
app.post('/api/crawl/stop', wrap(() => { crawlStatus.stop = true; }));
app.get('/api/crawl/status', wrap(() => crawlStatus));

// ---------- 요리 기록 ----------
app.post('/api/cook', wrap((req) => {
  const { recipeId, note = '', deductIds = [] } = req.body;
  need(db.prepare('SELECT 1 FROM recipes WHERE id=?').get(recipeId), '레시피를 찾지 못했어요');
  db.prepare('INSERT INTO cook_log(recipe_id, note) VALUES (?,?)').run(recipeId, note);
  // 재료 차감: 수량 1 감소, 0 이하가 되면 삭제
  for (const id of deductIds) {
    const row = db.prepare('SELECT qty FROM ingredients WHERE id=?').get(id);
    if (!row) continue;
    if (row.qty - 1 <= 0) db.prepare('DELETE FROM ingredients WHERE id=?').run(id);
    else db.prepare('UPDATE ingredients SET qty=? WHERE id=?').run(row.qty - 1, id);
  }
}));

app.get('/api/cook-log', wrap(() => ({
  stats: db.prepare(`SELECT r.id, r.title, r.image, r.rating, COUNT(*) count, MAX(l.cooked_at) last
    FROM cook_log l JOIN recipes r ON r.id = l.recipe_id GROUP BY r.id ORDER BY count DESC, last DESC`).all(),
  history: db.prepare(`SELECT l.id, l.cooked_at, l.note, r.id recipe_id, r.title
    FROM cook_log l JOIN recipes r ON r.id = l.recipe_id ORDER BY l.cooked_at DESC LIMIT 100`).all(),
})));
// 삭제한 기록을 되살립니다 (실행 취소용).
app.post('/api/cook-log/restore', wrap((req) => {
  const { recipeId, cookedAt, note = '' } = req.body;
  need(db.prepare('SELECT 1 FROM recipes WHERE id=?').get(recipeId), '레시피를 찾지 못했어요');
  db.prepare('INSERT INTO cook_log(recipe_id, cooked_at, note) VALUES (?,?,?)').run(recipeId, cookedAt, note);
}));
app.delete('/api/cook-log/:id', wrap((req) => { db.prepare('DELETE FROM cook_log WHERE id=?').run(req.params.id); }));

// ---------- 장보기 ----------
app.get('/api/shopping', wrap(() => db.prepare('SELECT * FROM shopping ORDER BY done, id').all()));
app.post('/api/shopping', wrap((req) => {
  const names = [].concat(req.body.names ?? req.body.name ?? []);
  const ins = db.prepare('INSERT OR IGNORE INTO shopping(name) VALUES (?)');
  names.map((n) => String(n).trim()).filter(Boolean).forEach((n) => ins.run(n));
}));
app.patch('/api/shopping/:id', wrap((req) => { db.prepare('UPDATE shopping SET done=? WHERE id=?').run(req.body.done ? 1 : 0, req.params.id); }));
app.delete('/api/shopping/:id', wrap((req) => { db.prepare('DELETE FROM shopping WHERE id=?').run(req.params.id); }));
// 구매 완료 항목을 냉장고 재료로 옮깁니다.
app.post('/api/shopping/move-done', wrap(() => {
  const done = db.prepare('SELECT * FROM shopping WHERE done=1').all();
  done.forEach((s) => {
    const e = expiryFrom(s.name, '냉장');
    db.prepare('INSERT INTO ingredients(name, expiry, expiry_est) VALUES (?,?,?)').run(s.name, e?.expiry ?? null, e ? 1 : 0);
    db.prepare('DELETE FROM shopping WHERE id=?').run(s.id);
  });
  return { moved: done.length };
}));

const PORT = process.env.PORT || 3939;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
