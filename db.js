import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(new URL('./data.db', import.meta.url).pathname);

db.exec(`
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '개',
  storage TEXT NOT NULL DEFAULT '냉장',
  expiry TEXT,
  added_at TEXT NOT NULL DEFAULT (date('now','localtime'))
);
CREATE TABLE IF NOT EXISTS staples (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  image TEXT,
  rating REAL NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  time TEXT,
  servings TEXT,
  description TEXT,
  ingredients TEXT NOT NULL,
  steps TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  cooked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  note TEXT
);
CREATE TABLE IF NOT EXISTS avoid (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS shopping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  done INTEGER NOT NULL DEFAULT 0
);
`);

// 소비기한을 일반 보관 기간으로 예상해 채운 재료인지 표시합니다.
if (!db.prepare("PRAGMA table_info(ingredients)").all().some((c) => c.name === 'expiry_est')) {
  db.exec('ALTER TABLE ingredients ADD COLUMN expiry_est INTEGER NOT NULL DEFAULT 0');
}

const DEFAULT_STAPLES = ['소금', '설탕', '간장', '진간장', '국간장', '후추', '후춧가루', '식용유', '물', '참기름',
  '들기름', '통깨', '깨', '고춧가루', '다진마늘', '식초', '올리고당', '맛술', '미림', '고추장', '된장', '쌈장',
  '마요네즈', '케첩', '굴소스', '버터', '밀가루', '부침가루', '튀김가루', '전분', '녹말', '얼음', '청주', '다시마', '멸치'];

if (db.prepare('SELECT COUNT(*) c FROM staples').get().c === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO staples(name) VALUES (?)');
  DEFAULT_STAPLES.forEach((n) => ins.run(n));
}
