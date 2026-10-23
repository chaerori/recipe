// 만개의레시피에서 별점 4.9 이상 레시피를 가져와 public/data/recipes.json(깃에 올라가지 않는 로컬 파일)에 합칩니다.
// 이 파일을 npm run upload 로 Supabase(로그인 전용)에 올려서 앱이 읽습니다.
// 사용: npm run crawl -- [--cats 반찬,메인요리] [--pages 2] [--min-reviews 3]
// 개인 용도로 천천히(요청 사이 1.2초) 가져옵니다.
import fs from 'node:fs';

const BASE = 'https://www.10000recipe.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const DELAY_MS = 1200;
const OUT = new URL('../public/data/recipes.json', import.meta.url).pathname;

// 앱 카테고리 -> 만개의레시피 종류별(cat4) 코드
const CATEGORIES = {
  '반찬': [63, 57], '메인요리': [56, 62, 65, 61], '국·찌개': [54, 55],
  '밥·면·만두': [52, 53], '간식·디저트': [59, 60, 66, 58], '샐러드': [64],
};

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => { const [k, ...v] = a.trim().split(/\s+/); return [k, v.join(' ')]; }));
const cats = args.cats ? args.cats.split(',') : Object.keys(CATEGORIES);
const pages = Number(args.pages || 2);
const minReviews = Number(args['min-reviews'] ?? 3);
const MIN_RATING = 4.9;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();

const parseList = (html) => html.split('common_sp_list_li').slice(1).map((chunk) => {
  const id = chunk.match(/href="\/recipe\/(\d+)"/)?.[1];
  const reviews = chunk.match(/common_sp_caption_rv_ea">\(([\d,]+)\)/)?.[1];
  const stars = (chunk.match(/icon_star2_on/g) || []).length;
  return id ? { id: Number(id), reviews: reviews ? Number(reviews.replace(/,/g, '')) : 0, stars } : null;
}).filter(Boolean);

function parseDetail(html) {
  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let d; try { d = JSON.parse(b[1]); } catch { try { d = JSON.parse(b[1].replace(/[\r\n\t]+/g, ' ')); } catch { continue; } }
    if (d?.['@type'] !== 'Recipe') continue;
    return {
      title: decode(d.name), image: (Array.isArray(d.image) ? d.image[0] : d.image) || null,
      rating: parseFloat(d.aggregateRating?.ratingValue) || 0, reviewCount: parseInt(d.aggregateRating?.reviewCount, 10) || 0,
      time: (d.totalTime || '').replace(/PT0H/, '').replace('PT', '').replace('M', '분').replace('H', '시간') || null,
      servings: (d.recipeYield || '').replace('servings', '인분').replace('serving', '인분') || null,
      ingredients: (d.recipeIngredient || []).map(decode).filter(Boolean),
      description: decode(d.description),
      steps: (d.recipeInstructions || []).map((s) => ({ text: decode(s.text) })),
    };
  }
  return null;
}

const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const known = new Set(all.map((r) => r.id));
let saved = 0, errors = 0;

for (const cat of cats) {
  for (const code of CATEGORIES[cat] || []) {
    for (let page = 1; page <= pages; page++) {
      console.log(`${cat} (cat ${code}) ${page}/${pages}쪽 목록 확인`);
      let items;
      try { items = parseList(await get(`${BASE}/recipe/list.html?cat4=${code}&order=reco&page=${page}`)); } catch { errors++; break; }
      await sleep(DELAY_MS);
      if (!items.length) break;
      for (const it of items.filter((i) => i.reviews >= minReviews && i.stars >= 4 && !known.has(i.id))) {
        try {
          const d = parseDetail(await get(`${BASE}/recipe/${it.id}`));
          if (d && d.rating >= MIN_RATING && d.reviewCount >= minReviews && d.ingredients.length) {
            all.push({ id: it.id, ...d, category: cat }); known.add(it.id); saved++;
          }
        } catch { errors++; }
        await sleep(DELAY_MS);
      }
      fs.writeFileSync(OUT, JSON.stringify(all)); // 중간에 멈춰도 가져온 만큼은 남도록 매 쪽마다 저장
    }
  }
}
all.sort((a, b) => a.id - b.id);
fs.writeFileSync(OUT, JSON.stringify(all));
console.log(`완료: ${saved}개 추가 (전체 ${all.length}개), 실패 ${errors}건`);
