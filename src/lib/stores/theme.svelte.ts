type Mode = 'light' | 'dark';

const STORAGE_KEY = 'investhelper-theme';

export const themeState = $state({ mode: 'light' as Mode });

function systemPrefersDark(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode: Mode) {
	document.documentElement.setAttribute('data-mode', mode);
}

export function initTheme() {
	if (typeof window === 'undefined') return;
	const saved = localStorage.getItem(STORAGE_KEY) as Mode | null;
	const mode: Mode = saved ?? (systemPrefersDark() ? 'dark' : 'light');
	themeState.mode = mode;
	apply(mode);
}

export function toggleTheme() {
	const next: Mode = themeState.mode === 'dark' ? 'light' : 'dark';
	themeState.mode = next;
	apply(next);
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// localStorage может быть недоступен (приватный режим) — переключение всё равно сработает в рамках сессии.
	}
}
