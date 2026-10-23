// 사용자 데이터 저장소. Supabase(설정이 있을 때) 또는 이 브라우저의 localStorage(로컬 모드).
// 테이블: ingredients, staples, avoid, cook_log, shopping — 모두 id 컬럼을 가집니다.
import { CONFIG } from './config.js';

export const isRemote = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

// ---------- 로컬 모드 ----------
function localStore() {
  const KEY = 'recipe:v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { seq: 0, t: {} }; } catch { return { seq: 0, t: {} }; } };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  return {
    async session() { return true; },
    async detail() { return null; }, // 로컬 모드에는 조리 순서 상세가 없습니다.
    async list(t) { return structuredClone(load().t[t] || []); },
    async insert(t, row) {
      const d = load(); const r = { ...row, id: ++d.seq };
      (d.t[t] ||= []).push(r); save(d); return structuredClone(r);
    },
    async update(t, id, patch) {
      const d = load(); const r = (d.t[t] || []).find((x) => x.id === id);
      if (r) Object.assign(r, patch); save(d);
    },
    async remove(t, id) { const d = load(); d.t[t] = (d.t[t] || []).filter((x) => x.id !== id); save(d); },
  };
}

// ---------- Supabase 모드 ----------
async function remoteStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const check = ({ data, error }) => {
    if (error) {
      if (error.code === 'PGRST301' || /JWT/i.test(error.message)) window.dispatchEvent(new Event('auth-required'));
      throw new Error(error.message);
    }
    return data;
  };
  return {
    sb,
    async session() { return !!(await sb.auth.getSession()).data.session; },
    async login(password) {
      const { error } = await sb.auth.signInWithPassword({ email: CONFIG.ACCOUNT_EMAIL, password });
      if (error) throw new Error('비밀번호가 맞지 않아요');
    },
    async logout() { await sb.auth.signOut(); },
    async recipes() { // 1000개 단위로 나눠 읽어 목록이 늘어나도 잘리지 않게 합니다.
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = check(await sb.from('recipes').select('id,title,image,rating,review_count,category,time,servings,ingredients').order('id').range(from, from + 999));
        out.push(...rows.map(({ review_count, ...r }) => ({ ...r, reviewCount: review_count })));
        if (rows.length < 1000) return out;
      }
    },
    async detail(id) { return check(await sb.from('recipe_details').select('description,steps').eq('recipe_id', id).maybeSingle()); },
    async list(t) { return check(await sb.from(t).select('*').order('id')); },
    async insert(t, row) { return check(await sb.from(t).insert(row).select().single()); },
    async update(t, id, patch) { check(await sb.from(t).update(patch).eq('id', id)); },
    async remove(t, id) { check(await sb.from(t).delete().eq('id', id)); },
  };
}

export const store = isRemote ? await remoteStore() : localStore();
