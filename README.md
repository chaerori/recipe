# 오늘의 레시피

냉장고 재료와 소비기한을 관리하고, [만개의레시피](https://www.10000recipe.com) 별점 4.9 이상 요리 중 **지금 있는 재료로 만들 수 있는 것부터** 추천하는 웹앱입니다.
서버 없이 정적 파일로 동작하며 GitHub Pages로 배포합니다.

- 레시피(제목·재료·별점·조리 순서 등): 공개 파일이 아니라 로그인해야만 읽을 수 있는 Supabase `recipes`, `recipe_details` 테이블에 둡니다. 저장소와 배포된 사이트에는 들어 있지 않습니다.
- 내 레시피: 추천 탭의 "+ 내 레시피"로 직접 적습니다. Supabase(또는 로컬 모드의 이 브라우저)에만 저장됩니다.
- 내 데이터(냉장고·기록·장보기·못 먹는 재료): [Supabase](https://supabase.com) 무료 DB. 설정하지 않으면 이 브라우저에만 저장하는 로컬 모드로 동작합니다.

## 로컬에서 실행

```bash
npm start   # http://localhost:3939
```

## 배포하기 (처음 한 번)

1. **Supabase 프로젝트 만들기** — supabase.com 에서 새 프로젝트를 만듭니다.
2. **테이블 만들기** — SQL Editor 에 [`supabase/schema.sql`](supabase/schema.sql) 을 붙여 넣고 실행합니다.
3. **계정 만들기** — Authentication > Users > Add user 에서 이메일과 비밀번호를 정하고, *Auto Confirm User* 를 켭니다. 이 비밀번호를 가족과 함께 씁니다.
   그다음 Authentication > Sign In / Providers 에서 *Allow new users to sign up* 을 꺼서 다른 사람이 가입하지 못하게 합니다.
4. **연결 정보 넣기** — `public/js/config.js` 에 Project URL, anon key(Project Settings > API), 위에서 만든 이메일을 넣습니다. anon key 는 공개해도 안전하며, 데이터는 RLS 가 보호합니다.
5. **레시피 올리기** — 아래 "레시피 가져오기·올리기"의 `npm run upload` 를 한 번 실행합니다.
6. **Pages 켜기** — 저장소 Settings > Pages > Source 를 **GitHub Actions** 로 바꿉니다.
7. `main` 에 푸시하면 [`pages.yml`](.github/workflows/pages.yml) 이 자동으로 배포합니다.
8. (권장) Settings > Secrets and variables > Actions > **Variables** 에 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 를 넣으면 [`keepalive.yml`](.github/workflows/keepalive.yml) 이 주 2회 접속해 무료 프로젝트가 정지되는 것을 막습니다.

## 레시피 가져오기·올리기

```bash
npm run crawl -- --cats 반찬,국·찌개 --pages 3 --min-reviews 3   # public/data/recipes.json 에 합침 (깃에는 올라가지 않음)
RECIPE_PASSWORD='계정 비밀번호' npm run upload                    # Supabase 로 올림 (로그인 전용 테이블)
```

요청 사이에 1.2초 간격을 두고 개인 용도로만 사용해 주세요. 만개의레시피 약관은 영리 목적의 복제·유통과 제3자 제공을 금지합니다. 이 데이터를 공개 저장소나 공개 파일에 올리지 마세요.
