<script lang="ts">
	import type { AllocationRow } from '$lib/utils/allocation';
	import { formatNumber, formatPercent } from '$lib/utils/format';

	interface Props {
		rows: AllocationRow[];
		size?: number;
	}

	let { rows, size: sizeProp }: Props = $props();

	let containerWidth = $state(640);
	const size = $derived(sizeProp ?? (containerWidth < 480 ? 220 : 280));

	// Палитра строится на лету: равномерный шаг по hue в OKLCH даёт
	// максимально различимые цвета при любом числе тикеров и работает
	// одинаково корректно в светлой и тёмной теме (фикс. lightness/chroma).
	function colorFor(index: number, total: number): string {
		if (total <= 0) return 'oklch(0.65 0.18 250)';
		const hue = (index * 360) / total + 15;
		// Чередуем lightness, чтобы соседние сегменты не сливались, если палитра большая.
		const lightness = index % 2 === 0 ? 0.65 : 0.55;
		return `oklch(${lightness} 0.17 ${hue})`;
	}

	const cx = $derived(size / 2);
	const cy = $derived(size / 2);
	const ringWidth = $derived(size * 0.12);
	const rOuter = $derived(size / 2 - ringWidth / 2 - 2);
	const rInner = $derived(rOuter - ringWidth - 4);

	interface Segment {
		row: AllocationRow;
		color: string;
		percent: number;
		offset: number;
	}

	const colored = $derived(
		rows.map((r, i) => ({ row: r, color: colorFor(i, rows.length) }))
	);

	function buildSegments(
		items: Array<{ row: AllocationRow; color: string }>,
		pick: (r: AllocationRow) => number
	): Segment[] {
		const out: Segment[] = [];
		let offset = 0;
		for (const it of items) {
			const percent = Math.max(0, pick(it.row));
			if (percent <= 0) continue;
			out.push({ row: it.row, color: it.color, percent, offset });
			offset += percent;
		}
		return out;
	}

	const actualSegments = $derived(buildSegments(colored, (r) => r.actualPercent));
	const targetSegments = $derived(buildSegments(colored, (r) => r.targetPercent));
</script>

<div
	class="card preset-tonal border-surface-200-800 flex flex-col items-center gap-4 border p-4 sm:flex-row sm:gap-6"
	bind:clientWidth={containerWidth}
>
	<svg
		viewBox="0 0 {size} {size}"
		width={size}
		height={size}
		class="shrink-0"
		role="img"
		aria-label="Распределение портфеля: внешнее кольцо — факт, внутреннее — цель"
	>
		<g transform="rotate(-90 {cx} {cy})">
			<circle
				{cx}
				{cy}
				r={rOuter}
				fill="none"
				stroke="var(--color-surface-200)"
				stroke-width={ringWidth}
				class="dark:[stroke:var(--color-surface-800)]"
			/>
			{#each actualSegments as seg (seg.row.ticker)}
				<circle
					{cx}
					{cy}
					r={rOuter}
					fill="none"
					stroke={seg.color}
					stroke-width={ringWidth}
					pathLength="100"
					stroke-dasharray="{seg.percent} 100"
					stroke-dashoffset={-seg.offset}
				>
					<title
						>{seg.row.ticker} — факт {formatPercent(seg.row.actualPercent)} (цель {formatPercent(
							seg.row.targetPercent
						)})</title
					>
				</circle>
			{/each}

			<circle
				{cx}
				{cy}
				r={rInner}
				fill="none"
				stroke="var(--color-surface-200)"
				stroke-width={ringWidth}
				class="dark:[stroke:var(--color-surface-800)]"
			/>
			{#each targetSegments as seg (seg.row.ticker)}
				<circle
					{cx}
					{cy}
					r={rInner}
					fill="none"
					stroke={seg.color}
					stroke-width={ringWidth}
					pathLength="100"
					stroke-dasharray="{seg.percent} 100"
					stroke-dashoffset={-seg.offset}
				>
					<title
						>{seg.row.ticker} — цель {formatPercent(seg.row.targetPercent)} (факт {formatPercent(
							seg.row.actualPercent
						)})</title
					>
				</circle>
			{/each}
		</g>

		<text
			x={cx}
			y={cy - 6}
			text-anchor="middle"
			class="fill-current text-xs opacity-70"
		>
			внешнее — факт
		</text>
		<text
			x={cx}
			y={cy + 10}
			text-anchor="middle"
			class="fill-current text-xs opacity-70"
		>
			внутреннее — цель
		</text>
	</svg>

	<ul class="w-full flex-1 space-y-1 text-sm sm:min-w-48">
		{#each colored as c (c.row.ticker)}
			{@const delta = c.row.deviation}
			<li class="flex items-center gap-2">
				<span
					class="inline-block h-3 w-3 shrink-0 rounded-sm"
					style="background:{c.color}"
				></span>
				<span class="font-mono">{c.row.ticker}</span>
				<span class="nums ml-auto opacity-70">
					{formatPercent(c.row.actualPercent)} / {formatPercent(c.row.targetPercent)}
				</span>
				<span
					class="nums w-14 text-right text-xs"
					class:text-warning-500={Math.abs(delta) >= 5 && Math.abs(delta) < 10}
					class:text-error-500={Math.abs(delta) >= 10}
					class:opacity-50={Math.abs(delta) < 5}
				>
					{delta >= 0 ? '+' : ''}{formatNumber(delta)}
				</span>
			</li>
		{/each}
	</ul>
</div>
