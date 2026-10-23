// public/data/recipes.json(로컬 파일)의 레시피를 Supabase 로 올립니다.
//   recipes        : 제목·재료·별점 등 목록 정보
//   recipe_details : 조리 순서·설명
// 두 테이블 모두 로그인한 계정만 읽을 수 있어서 사이트나 저장소에 공개되지 않습니다. 같은 번호는 덮어씁니다.
// 사용: RECIPE_PASSWORD='계정 비밀번호' npm run upload
import fs from 'node:fs';
import { CONFIG } from '../public/js/config.js';

const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: KEY, ACCOUNT_EMAIL: EMAIL } = CONFIG;
const PASSWORD = process.env.RECIPE_PASSWORD;
if (!URL_ || !KEY || !EMAIL || !PASSWORD) { console.error('config.js 의 Supabase 정보와 RECIPE_PASSWORD 환경변수가 필요해요.'); process.exit(1); }

const FILE = new URL('../public/data/recipes.json', import.meta.url).pathname;
if (!fs.existsSync(FILE)) { console.error('public/data/recipes.json 이 없어요. 먼저 npm run crawl 로 가져와 주세요.'); process.exit(1); }
const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) { console.error('로그인에 실패했어요. 비밀번호를 확인해 주세요.'); process.exit(1); }
const { access_token } = await login.json();

async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += 100) {
    const res = await fetch(`${URL_}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 100)),
    });
    if (!res.ok) { console.error(`${table} 업로드 실패:`, res.status, await res.text()); process.exit(1); }
    console.log(`${table} ${Math.min(i + 100, rows.length)}/${rows.length}`);
  }
}

await upsert('recipes', all.map((r) => ({
  id: r.id, title: r.title, image: r.image, rating: r.rating, review_count: r.reviewCount,
  category: r.category, time: r.time, servings: r.servings, ingredients: r.ingredients,
})));
await upsert('recipe_details', all.map((r) => ({ recipe_id: r.id, description: r.description || '', steps: r.steps || [] })));
console.log('완료: 레시피 목록과 조리 순서를 올렸어요.');
