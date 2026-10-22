import { db } from './db.js';

const BASE = 'https://www.10000recipe.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const DELAY_MS = 1200; // 개인용 소량 수집: 요청 간 간격을 둡니다.

// 앱 카테고리 -> 만개의레시피 종류별(cat4) 코드
export const CATEGORIES = {
  '반찬': [63, 57],
  '메인요리': [56, 62, 65, 61],
  '국·찌개': [54, 55],
  '밥·면·만두': [52, 53],
  '간식·디저트': [59, 60, 66, 58],
  '샐러드': [64],
};

export const status = { running: false, message: '대기 중', fetched: 0, saved: 0, errors: 0, stop: false };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const decode = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();

function parseList(html) {
  return html.split('common_sp_list_li').slice(1).map((chunk) => {
    const id = chunk.match(/href="\/recipe\/(\d+)"/)?.[1];
    const reviews = chunk.match(/common_sp_caption_rv_ea">\(([\d,]+)\)/)?.[1];
    const stars = (chunk.match(/icon_star2_on/g) || []).length;
    return id ? { id: Number(id), reviews: reviews ? Number(reviews.replace(/,/g, '')) : 0, stars } : null;
  }).filter(Boolean);
}

function parseDetail(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    let d;
    try { d = JSON.parse(b[1], undefined); } catch { try { d = JSON.parse(b[1].replace(/[\r\n\t]+/g, ' ')); } catch { continue; } }
    if (d?.['@type'] !== 'Recipe') continue;
    const img = Array.isArray(d.image) ? d.image[0] : d.image;
    return {
      title: decode(d.name),
      image: img || null,
      rating: parseFloat(d.aggregateRating?.ratingValue) || 0,
      reviewCount: parseInt(d.aggregateRating?.reviewCount, 10) || 0,
      time: (d.totalTime || '').replace(/PT0H/, '').replace('PT', '').replace('M', '분').replace('H', '시간') || null,
      servings: (d.recipeYield || '').replace('servings', '인분').replace('serving', '인분') || null,
      description: decode(d.description),
      ingredients: (d.recipeIngredient || []).map(decode).filter(Boolean),
      steps: (d.recipeInstructions || []).map((s) => ({ text: decode(s.text), image: s.image || null })),
    };
  }
  return null;
}

const upsert = db.prepare(`INSERT INTO recipes(id,title,image,rating,review_count,category,time,servings,description,ingredients,steps)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET rating=excluded.rating, review_count=excluded.review_count,
    ingredients=excluded.ingredients, steps=excluded.steps, fetched_at=datetime('now','localtime')`);
const known = db.prepare('SELECT 1 FROM recipes WHERE id=?');

export async function crawl({ categories, pages = 3, minRating = 4.9, minReviews = 3 }) {
  if (status.running) throw new Error('이미 가져오는 중이에요');
  Object.assign(status, { running: true, stop: false, fetched: 0, saved: 0, errors: 0, message: '시작했어요' });
  try {
    for (const cat of categories) {
      for (const code of CATEGORIES[cat] || []) {
        for (let page = 1; page <= pages; page++) {
          if (status.stop) return;
          status.message = `${cat} 목록 확인 중 (${page}/${pages}쪽)`;
          let items;
          try { items = parseList(await get(`${BASE}/recipe/list.html?cat4=${code}&order=reco&page=${page}`)); }
          catch (e) { status.errors++; break; }
          await sleep(DELAY_MS);
          if (!items.length) break;
          // 목록의 후기 수·별 개수로 상세 요청 대상을 먼저 걸러 요청량을 줄입니다.
          for (const it of items.filter((i) => i.reviews >= minReviews && i.stars >= 4 && !known.get(i.id))) {
            if (status.stop) return;
            status.message = `${cat} 레시피 확인 중`;
            try {
              const d = parseDetail(await get(`${BASE}/recipe/${it.id}`));
              status.fetched++;
              if (d && d.rating >= minRating && d.reviewCount >= minReviews && d.ingredients.length) {
                upsert.run(it.id, d.title, d.image, d.rating, d.reviewCount, cat, d.time, d.servings, d.description,
                  JSON.stringify(d.ingredients), JSON.stringify(d.steps));
                status.saved++;
              }
            } catch { status.errors++; }
            await sleep(DELAY_MS);
          }
        }
      }
    }
  } finally {
    status.running = false;
    status.message = status.stop ? '중지했어요' : '완료했어요';
  }
}
