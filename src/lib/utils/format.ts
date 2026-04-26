const rub = new Intl.NumberFormat('ru-RU', {
	style: 'currency',
	currency: 'RUB',
	maximumFractionDigits: 2
});

const num = new Intl.NumberFormat('ru-RU', {
	maximumFractionDigits: 4
});

const pct = new Intl.NumberFormat('ru-RU', {
	style: 'percent',
	maximumFractionDigits: 2,
	minimumFractionDigits: 0
});

export function formatRub(value: number): string {
	if (!Number.isFinite(value)) return '—';
	return rub.format(value);
}

export function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return '—';
	return num.format(value);
}

export function formatPercent(value0to100: number): string {
	if (!Number.isFinite(value0to100)) return '—';
	return pct.format(value0to100 / 100);
}
