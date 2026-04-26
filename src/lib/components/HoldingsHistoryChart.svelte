<script lang="ts">
	import type { Transaction } from '$lib/stores/transactions.svelte';
	import { formatNumber, formatRub } from '$lib/utils/format';

	type Mode = 'lots' | 'value';

	interface Props {
		transactions: Transaction[];
		mode?: Mode;
		prices?: Map<string, number>;
		height?: number;
	}

	let {
		transactions,
		mode = 'lots',
		prices = new Map(),
		height = 280
	}: Props = $props();

	let containerWidth = $state(720);
	const width = $derived(Math.max(320, containerWidth));
	const isNarrow = $derived(width < 480);
	const padLeft = $derived(isNarrow ? 36 : 44);
	const padRight = 12;
	const padTop = 12;
	const padBottom = $derived(isNarrow ? 24 : 28);
	const innerW = $derived(width - padLeft - padRight);
	const innerH = $derived(height - padTop - padBottom);

	function colorFor(index: number, total: number): string {
		if (total <= 0) return 'oklch(0.65 0.18 250)';
		const hue = (index * 360) / total + 15;
		const lightness = index % 2 === 0 ? 0.65 : 0.55;
		return `oklch(${lightness} 0.17 ${hue})`;
	}

	interface Point {
		t: number; // ms
		qty: number; // штуки (cumulative)
		lots: number;
		value: number; // qty * текущая цена, ₽
	}

	interface Series {
		ticker: string;
		points: Point[];
		color: string;
		price: number;
		currentQty: number;
		currentLots: number;
		currentValue: number;
	}

	const seriesData = $derived.by<{
		series: Series[];
		minT: number;
		maxT: number;
		maxY: number;
	}>(() => {
		const valid = transactions.filter((t) => t.date instanceof Date);
		if (valid.length === 0) {
			return { series: [], minT: 0, maxT: 0, maxY: 0 };
		}
		const byTicker = new Map<string, Transaction[]>();
		for (const txn of valid) {
			const list = byTicker.get(txn.ticker) ?? [];
			list.push(txn);
			byTicker.set(txn.ticker, list);
		}
		const tickers = Array.from(byTicker.keys()).sort();
		const now = Date.now();
		let minT = Infinity;
		let maxT = -Infinity;
		let maxY = 0;
		const series: Series[] = tickers.map((ticker, i) => {
			const list = (byTicker.get(ticker) ?? [])
				.slice()
				.sort((a, b) => (a.date!.getTime() - b.date!.getTime()));
			const price = prices.get(ticker) ?? 0;
			const points: Point[] = [];
			let qty = 0;
			for (const t of list) {
				qty += t.qty;
				const lotsize = Math.max(1, t.lotsize || 1);
				const lots = qty / lotsize;
				const value = qty * price;
				points.push({ t: t.date!.getTime(), qty, lots, value });
				if (t.date!.getTime() < minT) minT = t.date!.getTime();
				if (t.date!.getTime() > maxT) maxT = t.date!.getTime();
				const y = mode === 'value' ? value : lots;
				if (y > maxY) maxY = y;
			}
			const last = points[points.length - 1];
			return {
				ticker,
				points,
				color: colorFor(i, tickers.length),
				price,
				currentQty: last?.qty ?? 0,
				currentLots: last?.lots ?? 0,
				currentValue: last?.value ?? 0
			};
		});
		if (maxT < now) maxT = now;
		if (!Number.isFinite(minT)) minT = now - 24 * 60 * 60 * 1000;
		if (minT === maxT) {
			minT -= 24 * 60 * 60 * 1000;
		}
		return { series, minT, maxT, maxY };
	});

	function yValue(p: Point): number {
		return mode === 'value' ? p.value : p.lots;
	}

	function formatYTick(v: number): string {
		return mode === 'value' ? formatRub(v) : formatNumber(v);
	}

	function xFor(t: number): number {
		const { minT, maxT } = seriesData;
		if (maxT === minT) return padLeft;
		return padLeft + ((t - minT) / (maxT - minT)) * innerW;
	}

	function yFor(v: number): number {
		const { maxY } = seriesData;
		const top = Math.max(mode === 'value' ? 1e-9 : 1, maxY);
		return padTop + innerH - (v / top) * innerH;
	}

	function pathFor(s: Series): string {
		if (s.points.length === 0) return '';
		const now = Date.now();
		const cmds: string[] = [];
		// Начинаем от первой точки (initial)
		const first = s.points[0];
		cmds.push(`M ${xFor(first.t)} ${yFor(yValue(first))}`);
		// Step-after: горизонталь до следующей точки времени, потом вертикаль до нового уровня
		for (let i = 1; i < s.points.length; i++) {
			const p = s.points[i];
			cmds.push(`L ${xFor(p.t)} ${yFor(yValue(s.points[i - 1]))}`);
			cmds.push(`L ${xFor(p.t)} ${yFor(yValue(p))}`);
		}
		// Продлеваем до сегодня по последнему уровню
		const last = s.points[s.points.length - 1];
		cmds.push(`L ${xFor(now)} ${yFor(yValue(last))}`);
		return cmds.join(' ');
	}

	const dateFmt = new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});

	const xTicks = $derived.by(() => {
		const { minT, maxT } = seriesData;
		if (!Number.isFinite(minT) || !Number.isFinite(maxT) || maxT <= minT) return [] as number[];
		const count = isNarrow ? 2 : 4;
		const out: number[] = [];
		for (let i = 0; i <= count; i++) {
			out.push(minT + ((maxT - minT) * i) / count);
		}
		return out;
	});

	const dateFmtShort = new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: '2-digit'
	});

	const yTicks = $derived.by(() => {
		const { maxY } = seriesData;
		const top = mode === 'value' ? Math.max(1, maxY) : Math.max(1, Math.ceil(maxY));
		const count = 4;
		const out: number[] = [];
		for (let i = 0; i <= count; i++) {
			out.push((top * i) / count);
		}
		return out;
	});
</script>

{#if seriesData.series.length === 0}
	<div class="card preset-tonal p-4 text-sm opacity-70">Пока нет операций для построения графика.</div>
{:else}
	<div class="card border-surface-200-800 border p-3" bind:clientWidth={containerWidth}>
		<svg
			viewBox="0 0 {width} {height}"
			width="100%"
			height={height}
			role="img"
			aria-label="История количества лотов по бумагам"
		>
			<g aria-hidden="true">
				{#each yTicks as tick (tick)}
					<line
						x1={padLeft}
						x2={width - padRight}
						y1={yFor(tick)}
						y2={yFor(tick)}
						stroke="var(--color-surface-300)"
						stroke-dasharray="2 3"
						class="dark:[stroke:var(--color-surface-700)]"
					/>
					<text
						x={padLeft - 6}
						y={yFor(tick) + 3}
						text-anchor="end"
						class="fill-current opacity-60"
						style:font-size={isNarrow ? '10px' : '12px'}
					>
						{formatYTick(tick)}
					</text>
				{/each}
				{#each xTicks as tick (tick)}
					<text
						x={xFor(tick)}
						y={height - 8}
						text-anchor="middle"
						class="fill-current opacity-60"
						style:font-size={isNarrow ? '10px' : '12px'}
					>
						{(isNarrow ? dateFmtShort : dateFmt).format(new Date(tick))}
					</text>
				{/each}
			</g>

			{#each seriesData.series as s (s.ticker)}
				<path d={pathFor(s)} fill="none" stroke={s.color} stroke-width="2" />
				{#each s.points as p (p.t)}
					<circle cx={xFor(p.t)} cy={yFor(yValue(p))} r="3" fill={s.color}>
						<title
							>{s.ticker} — {mode === 'value'
								? formatRub(p.value)
								: formatNumber(p.lots) + ' лот.'} ({formatNumber(p.qty)} шт.) · {dateFmt.format(
								new Date(p.t)
							)}</title
						>
					</circle>
				{/each}
			{/each}
		</svg>

		<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
			{#each seriesData.series as s (s.ticker)}
				<li class="flex items-center gap-2">
					<span
						class="inline-block h-3 w-3 shrink-0 rounded-sm"
						style="background:{s.color}"
					></span>
					<span class="font-mono">{s.ticker}</span>
					<span class="nums opacity-70">
						{#if mode === 'value'}
							{s.price > 0 ? formatRub(s.currentValue) : '—'}
						{:else}
							{formatNumber(s.currentLots)} лот.
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}
