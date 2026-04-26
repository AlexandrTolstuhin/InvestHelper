// Тонкая обёртка над публичным MOEX ISS API.
// Документация: https://iss.moex.com/iss/reference/
//
// Используем три эндпоинта:
//   1. /securities/{ticker}.json                        — metadata + список досок
//   2. /securities.json?q=...                           — поиск/автокомплит
//   3. /engines/{e}/markets/{m}/boards/{b}/securities.json?securities=A,B,C
//      — групповая выгрузка цен и lotsize для нескольких бумаг с одной доски

const BASE = 'https://iss.moex.com/iss';

// Универсальный парсер ISS-блока вида { columns: string[], data: unknown[][] }
// в массив объектов с ключами в нижнем регистре.
interface IssBlock {
	columns: string[];
	data: unknown[][];
}

function parseBlock<T>(block: IssBlock | undefined): T[] {
	if (!block) return [];
	return block.data.map((row) => {
		const obj: Record<string, unknown> = {};
		for (let i = 0; i < block.columns.length; i++) {
			obj[block.columns[i]] = row[i];
		}
		return obj as T;
	});
}

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`MOEX ISS ${res.status}: ${url}`);
	}
	return (await res.json()) as T;
}

export interface SecurityRef {
	ticker: string;
	shortName: string;
	engine: string; // "stock"
	market: string; // "shares" / "bonds"
	board: string; // "TQTF" / "TQBR" / "TQOB"
}

export interface SecuritySearchHit {
	ticker: string;
	shortName: string;
	primaryBoard: string | null;
	type: string | null;
}

interface DescriptionRow {
	name: string;
	value: string;
}

interface BoardRow {
	secid: string;
	boardid: string;
	market: string;
	engine: string;
	is_primary: number;
	currencyid: string;
	is_traded: number;
}

// Получить базовое описание бумаги: shortname и каноническую RUB-доску.
// Метаданные практически не меняются — храним сутки и переживаем перезагрузки страницы.
const LOOKUP_TTL_MS = 24 * 60 * 60_000;
const lookupCache = new Map<string, { value: SecurityRef; fetchedAt: number }>();
const lookupInflight = new Map<string, Promise<SecurityRef>>();

export async function lookupSecurity(ticker: string): Promise<SecurityRef> {
	const key = ticker.trim().toUpperCase();
	const now = Date.now();
	const cached = lookupCache.get(key);
	if (cached && now - cached.fetchedAt < LOOKUP_TTL_MS) {
		return cached.value;
	}
	const inflight = lookupInflight.get(key);
	if (inflight) return inflight;
	const promise = (async () => {
		try {
			const v = await lookupSecurityImpl(key);
			lookupCache.set(key, { value: v, fetchedAt: Date.now() });
			saveToStorage();
			return v;
		} finally {
			lookupInflight.delete(key);
		}
	})();
	lookupInflight.set(key, promise);
	return promise;
}

async function lookupSecurityImpl(ticker: string): Promise<SecurityRef> {
	const url = `${BASE}/securities/${encodeURIComponent(ticker)}.json?iss.meta=off&iss.only=description,boards`;
	const json = await getJson<{
		description: IssBlock;
		boards: IssBlock;
	}>(url);

	const description = parseBlock<DescriptionRow>(json.description);
	const boards = parseBlock<BoardRow>(json.boards);

	if (boards.length === 0) {
		throw new Error(`Бумага ${ticker} не найдена на MOEX`);
	}

	const board =
		boards.find((b) => b.is_primary === 1 && b.currencyid === 'RUB' && b.is_traded === 1) ??
		boards.find((b) => b.is_primary === 1) ??
		boards.find((b) => b.is_traded === 1) ??
		boards[0];

	const shortName = description.find((d) => d.name === 'SHORTNAME')?.value ?? ticker;
	const secid = description.find((d) => d.name === 'SECID')?.value ?? ticker;

	return {
		ticker: secid.toUpperCase(),
		shortName,
		engine: board.engine,
		market: board.market,
		board: board.boardid
	};
}

interface SecuritiesSearchRow {
	secid: string;
	shortname: string;
	primary_boardid: string | null;
	type: string | null;
}

// Кеш поиска: ключ — нормализованный запрос + limit.
// TTL 5 минут хватает, чтобы повторный ввод того же текста не бил по MOEX.
const SEARCH_TTL_MS = 5 * 60_000;
const SEARCH_MAX_ENTRIES = 100;
const searchCache = new Map<string, { value: SecuritySearchHit[]; fetchedAt: number }>();
const searchInflight = new Map<string, Promise<SecuritySearchHit[]>>();

export async function searchSecurities(query: string, limit = 10): Promise<SecuritySearchHit[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];
	const key = `${trimmed.toLowerCase()}|${limit}`;
	const now = Date.now();
	const cached = searchCache.get(key);
	if (cached && now - cached.fetchedAt < SEARCH_TTL_MS) {
		// LRU touch: переставляем в конец.
		searchCache.delete(key);
		searchCache.set(key, cached);
		return cached.value;
	}
	const inflight = searchInflight.get(key);
	if (inflight) return inflight;
	const promise = (async () => {
		try {
			const url = `${BASE}/securities.json?iss.meta=off&q=${encodeURIComponent(trimmed)}&limit=${limit}&engine=stock`;
			const json = await getJson<{ securities: IssBlock }>(url);
			const value = parseBlock<SecuritiesSearchRow>(json.securities).map((row) => ({
				ticker: row.secid.toUpperCase(),
				shortName: row.shortname,
				primaryBoard: row.primary_boardid,
				type: row.type
			}));
			searchCache.set(key, { value, fetchedAt: Date.now() });
			while (searchCache.size > SEARCH_MAX_ENTRIES) {
				const oldest = searchCache.keys().next().value;
				if (oldest === undefined) break;
				searchCache.delete(oldest);
			}
			return value;
		} finally {
			searchInflight.delete(key);
		}
	})();
	searchInflight.set(key, promise);
	return promise;
}

export interface PriceQuote {
	ticker: string;
	price: number; // в рублях за единицу бумаги
	lotsize: number;
	shortName: string;
	source: 'LAST' | 'LCURRENTPRICE' | 'MARKETPRICE' | 'PREVPRICE';
	fetchedAt: number;
}

interface SecuritiesPriceRow {
	SECID: string;
	BOARDID: string;
	SHORTNAME: string;
	PREVPRICE: number | null;
	LOTSIZE: number | null;
}

interface MarketDataRow {
	SECID: string;
	BOARDID: string;
	LAST: number | null;
	LCURRENTPRICE: number | null;
	MARKETPRICE: number | null;
}

const cache = new Map<string, PriceQuote>();
// Котировки MOEX обновляются с задержкой ~15 мин, чаще раз в 10 мин ходить смысла нет.
const CACHE_TTL_MS = 10 * 60_000;

// Персистим кэш котировок и метаданных в localStorage одним JSON-блобом —
// при перезагрузке страницы цены появляются мгновенно из кэша.
const STORAGE_KEY = 'moex-cache-v1';
const STORAGE_VERSION = 1;
const STORAGE_MAX_QUOTES = 200;

interface StorageBlob {
	v: number;
	quotes: PriceQuote[];
	lookups: Array<[string, SecurityRef, number]>;
}

function loadFromStorage() {
	if (typeof window === 'undefined') return;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as StorageBlob;
		if (!parsed || parsed.v !== STORAGE_VERSION) return;
		const now = Date.now();
		for (const q of parsed.quotes ?? []) {
			if (q && typeof q.fetchedAt === 'number' && now - q.fetchedAt < CACHE_TTL_MS) {
				cache.set(q.ticker, q);
			}
		}
		for (const entry of parsed.lookups ?? []) {
			if (!Array.isArray(entry) || entry.length !== 3) continue;
			const [key, value, fetchedAt] = entry;
			if (typeof fetchedAt === 'number' && now - fetchedAt < LOOKUP_TTL_MS) {
				lookupCache.set(key, { value, fetchedAt });
			}
		}
	} catch {
		// Битый JSON / отказ доступа к localStorage — продолжаем с пустым кэшем.
	}
}

function saveToStorage() {
	if (typeof window === 'undefined') return;
	try {
		// Эвикция: если котировок накопилось больше потолка, выкидываем самые старые.
		if (cache.size > STORAGE_MAX_QUOTES) {
			const sorted = Array.from(cache.values()).sort((a, b) => b.fetchedAt - a.fetchedAt);
			cache.clear();
			for (const q of sorted.slice(0, STORAGE_MAX_QUOTES)) {
				cache.set(q.ticker, q);
			}
		}
		const blob: StorageBlob = {
			v: STORAGE_VERSION,
			quotes: Array.from(cache.values()),
			lookups: Array.from(lookupCache.entries()).map(
				([k, v]) => [k, v.value, v.fetchedAt] as [string, SecurityRef, number]
			)
		};
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
	} catch {
		// Quota exceeded или приватный режим — игнорируем, in-memory кэш остаётся рабочим.
	}
}

loadFromStorage();

export function clearQuotesCache() {
	cache.clear();
	if (typeof window !== 'undefined') {
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* noop */
		}
	}
}

export function clearAllMoexCaches() {
	cache.clear();
	searchCache.clear();
	lookupCache.clear();
	if (typeof window !== 'undefined') {
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* noop */
		}
	}
}

// Группируем тикеры по доске (на одной доске — один запрос),
// затем мерджим securities (LOTSIZE, SHORTNAME, PREVPRICE) и marketdata (LAST/LCURRENTPRICE/MARKETPRICE).
export async function fetchQuotes(refs: SecurityRef[]): Promise<Map<string, PriceQuote>> {
	const result = new Map<string, PriceQuote>();
	const now = Date.now();

	const toFetch: SecurityRef[] = [];
	for (const ref of refs) {
		const cached = cache.get(ref.ticker);
		if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
			result.set(ref.ticker, cached);
		} else {
			toFetch.push(ref);
		}
	}

	const groups = new Map<string, SecurityRef[]>();
	for (const ref of toFetch) {
		const key = `${ref.engine}|${ref.market}|${ref.board}`;
		const arr = groups.get(key) ?? [];
		arr.push(ref);
		groups.set(key, arr);
	}

	await Promise.all(
		Array.from(groups.values()).map(async (group) => {
			const { engine, market, board } = group[0];
			const tickers = group.map((g) => g.ticker).join(',');
			const url = `${BASE}/engines/${engine}/markets/${market}/boards/${board}/securities.json?iss.meta=off&iss.only=securities,marketdata&securities=${encodeURIComponent(tickers)}`;
			const json = await getJson<{ securities: IssBlock; marketdata: IssBlock }>(url);
			const secRows = parseBlock<SecuritiesPriceRow>(json.securities);
			const mdRows = parseBlock<MarketDataRow>(json.marketdata);
			const mdByTicker = new Map<string, MarketDataRow>();
			for (const row of mdRows) mdByTicker.set(row.SECID, row);

			for (const sec of secRows) {
				const md = mdByTicker.get(sec.SECID);
				const picked = pickPrice(md, sec);
				if (!picked) continue;
				const quote: PriceQuote = {
					ticker: sec.SECID,
					price: picked.price,
					lotsize: sec.LOTSIZE ?? 1,
					shortName: sec.SHORTNAME ?? sec.SECID,
					source: picked.source,
					fetchedAt: now
				};
				cache.set(quote.ticker, quote);
				result.set(quote.ticker, quote);
			}
		})
	);

	if (toFetch.length > 0) saveToStorage();

	return result;
}

function pickPrice(
	md: MarketDataRow | undefined,
	sec: SecuritiesPriceRow
): { price: number; source: PriceQuote['source'] } | null {
	const candidates: Array<[PriceQuote['source'], number | null | undefined]> = [
		['LAST', md?.LAST],
		['LCURRENTPRICE', md?.LCURRENTPRICE],
		['MARKETPRICE', md?.MARKETPRICE],
		['PREVPRICE', sec.PREVPRICE]
	];
	for (const [source, value] of candidates) {
		if (typeof value === 'number' && value > 0) {
			return { price: value, source };
		}
	}
	return null;
}
