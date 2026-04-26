# InvestHelper

Лёгкое статическое веб-приложение для составления и ребалансировки инвестиционных портфелей на Московской бирже. Котировки берутся напрямую из публичного MOEX ISS, данные пользователей хранятся в Firestore, авторизация через Google. Хостится на GitHub Pages.

## Возможности

- Несколько портфелей на пользователя.
- Холдинги с автокомплитом тикеров MOEX, целевыми долями, текущей ценой, lotsize.
- Рекомендации, сколько каких бумаг купить на внесённую сумму, чтобы приблизить веса к целевым (с учётом лотности).
- Защита от злоупотреблений: allowlist email-адресов в Firestore, App Check (reCAPTCHA v3), валидация полей в правилах безопасности.

## Стек

SvelteKit 5 + TypeScript, Tailwind 4, Skeleton UI 3, Firebase (Auth + Firestore + App Check), MOEX ISS REST.

## Локальный запуск (Windows)

```cmd
npm install
copy .env.example .env.local
:: заполнить значения VITE_FIREBASE_* из Firebase Console
npm run dev
```

Для сборки под GitHub Pages:

```cmd
npm run build:gh-pages
```

Запуск тестов:

```cmd
npm test
```

## Настройка Firebase

1. Создайте проект в [Firebase Console](https://console.firebase.google.com/), включите Authentication → Google и Firestore Database (Native, тариф Spark).
2. В Authentication → Settings → Authorized domains добавьте `localhost` и `<user>.github.io`.
3. В Project settings → General скопируйте web-конфиг в `.env.local` (см. `.env.example`).
4. Включите App Check, провайдер reCAPTCHA v3, скопируйте site key в `VITE_FIREBASE_APPCHECK_SITE_KEY`. В Firestore включите enforcement.
5. Загрузите правила из `firestore.rules` (через Firebase Console → Firestore → Rules или CLI).
6. Через Firebase Console → Firestore вручную создайте коллекцию `allowedEmails` и для каждого пользователя добавьте документ с ID = email (например `you@gmail.com`). Без этого никто, включая владельца, не сможет работать с данными.
7. В Google Cloud Console → Billing → Budgets установите бюджет $1/мес — на случай выхода за Spark.

## Деплой на GitHub Pages

1. Создайте репозиторий с именем `InvestHelper` (имя влияет на base path; если другое — поправьте `BASE_PATH` в `.github/workflows/deploy.yml` и при необходимости в скрипте `build:gh-pages`).
2. В Settings → Pages выберите Source = GitHub Actions.
3. В Settings → Secrets and variables → Actions добавьте все `VITE_FIREBASE_*` секреты, указанные в workflow.
4. Запушьте `main` — пайплайн соберёт и опубликует.

## Структура

- `src/lib/firebase.ts` — инициализация Firebase + App Check.
- `src/lib/stores/*.svelte.ts` — реактивные сторы Svelte 5 (auth, portfolios, holdings).
- `src/lib/api/moex.ts` — клиент MOEX ISS с тремя уровнями кеша (60с цены, 5 мин поиск, 1ч lookup).
- `src/lib/rebalance/` — модуль ребалансировки с интерфейсом `RebalanceStrategy`. Сейчас реализован только `buyOnlyStrategy`.
- `src/lib/components/AuthGuard.svelte` — обёртка для защищённых страниц.
- `firestore.rules` — security rules с allowlist и валидацией полей.
- `scripts/postbuild-spa.mjs` — копирует `index.html` в `404.html` для SPA-роутинга на GitHub Pages.

## Замечания

- Котировки MOEX задержаны на ~15 минут — этого достаточно для планирования покупок, но не для интрадей-сценариев.
- Это не является инвестиционной рекомендацией. Для облигаций цены берутся "грязными" (без отдельного учёта НКД).
- Брокерские комиссии не учитываются.
