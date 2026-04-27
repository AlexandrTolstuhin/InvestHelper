import type {
	RebalanceHolding,
	RebalanceInput,
	RebalanceItem,
	RebalanceResult,
	RebalanceStrategy
} from './types';

// Эпсилон для сравнения процентов с поправкой на плавающую запятую.
const EPS = 1e-9;

interface InternalRow {
	ref: RebalanceHolding;
	currentValue: number;
	lotCost: number;
	targetValue: number; // считается после знания totalNewValue
	lots: number;
	excluded: boolean;
	exclusionReason?: string;
}

export const buyOnlyStrategy: RebalanceStrategy = {
	id: 'buy-only',
	compute(input: RebalanceInput): RebalanceResult {
		const deposit = Math.max(0, input.deposit);
		const warnings: string[] = [];

		const rows: InternalRow[] = input.holdings.map((h) => {
			const lotCost = h.price * h.lotsize;
			const validPrice = Number.isFinite(h.price) && h.price > 0;
			const validLot = Number.isFinite(h.lotsize) && h.lotsize >= 1;
			const validQty = Number.isFinite(h.quantity) && h.quantity >= 0;
			const validTarget =
				Number.isFinite(h.targetPercent) && h.targetPercent >= 0 && h.targetPercent <= 100;
			let excluded = false;
			let reason: string | undefined;
			if (!validPrice) {
				excluded = true;
				reason = 'нет цены';
			} else if (!validLot) {
				excluded = true;
				reason = 'неизвестный лот';
			} else if (!validQty) {
				excluded = true;
				reason = 'некорректное количество';
			} else if (!validTarget) {
				excluded = true;
				reason = 'некорректная цель';
			}
			return {
				ref: h,
				currentValue: validPrice && validQty ? h.price * h.quantity : 0,
				lotCost: validPrice && validLot ? lotCost : 0,
				targetValue: 0,
				lots: 0,
				excluded,
				exclusionReason: reason
			};
		});

		const totalCurrentValue = rows.reduce((s, r) => s + r.currentValue, 0);
		const totalNewValue = totalCurrentValue + deposit;

		// Сумма процентов по активным позициям с положительной целью.
		const sumTargets = rows
			.filter((r) => !r.excluded && r.ref.targetPercent > 0)
			.reduce((s, r) => s + r.ref.targetPercent, 0);

		if (sumTargets > 0 && Math.abs(sumTargets - 100) > 0.01) {
			warnings.push(
				`Сумма целевых долей ${sumTargets.toFixed(2)}% не равна 100% — нормализуем пропорционально.`
			);
		}

		const targetScale = sumTargets > 0 ? 100 / sumTargets : 0;

		const needs: number[] = rows.map((r) => {
			if (r.excluded || r.ref.targetPercent <= 0) return 0;
			const normalizedPct = r.ref.targetPercent * targetScale;
			r.targetValue = (totalNewValue * normalizedPct) / 100;
			return Math.max(0, r.targetValue - r.currentValue);
		});

		const needSum = needs.reduce((s, n) => s + n, 0);
		const allocations: number[] = needs.map((n) =>
			needSum > deposit && needSum > 0 ? (n * deposit) / needSum : n
		);

		// Первичное приближение — округление вниз до лотов.
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (r.excluded || r.lotCost <= 0) continue;
			r.lots = Math.floor(allocations[i] / r.lotCost);
		}

		// Жадный догон: пока есть бумаги, на которые хватает ещё одного лота,
		// добавляем туда, где относительный недобор до цели максимален.
		let spent = rows.reduce((s, r) => s + r.lots * r.lotCost, 0);
		let leftover = deposit - spent;

		const eligible = () =>
			rows.filter((r) => !r.excluded && r.lotCost > 0 && r.lotCost <= leftover + EPS);

		while (true) {
			const candidates = eligible();
			if (candidates.length === 0) break;

			let bestIdx = -1;
			let bestScore = -Infinity;
			for (const r of candidates) {
				if (r.targetValue <= 0) continue;
				const newValue = r.currentValue + r.lots * r.lotCost;
				const score = (r.targetValue - newValue) / Math.max(r.targetValue, EPS);
				if (score > bestScore) {
					bestScore = score;
					bestIdx = rows.indexOf(r);
				}
			}
			// Если все кандидаты уже на/выше цели — дальше не докупаем.
			if (bestIdx < 0 || bestScore <= 0) break;
			rows[bestIdx].lots += 1;
			leftover -= rows[bestIdx].lotCost;
		}

		spent = rows.reduce((s, r) => s + r.lots * r.lotCost, 0);
		leftover = deposit - spent;

		const finalNewTotal = totalCurrentValue + spent;

		const items: RebalanceItem[] = rows.map((r) => {
			const lotsToBuy = r.lots;
			const qtyToBuy = lotsToBuy * (r.ref.lotsize || 0);
			const newQty = r.ref.quantity + qtyToBuy;
			const newValue = newQty * r.ref.price;
			return {
				ticker: r.ref.ticker,
				shortName: r.ref.shortName,
				displayName: r.ref.displayName ?? r.ref.shortName,
				price: r.ref.price,
				lotsize: r.ref.lotsize,
				currentQty: r.ref.quantity,
				currentValue: r.currentValue,
				currentPercent:
					totalCurrentValue > 0 ? (r.currentValue / totalCurrentValue) * 100 : 0,
				targetPercent: r.ref.targetPercent,
				targetValue: r.targetValue,
				lotsToBuy,
				qtyToBuy,
				spend: lotsToBuy * r.lotCost,
				newQty,
				newValue,
				newPercent: finalNewTotal > 0 ? (newValue / finalNewTotal) * 100 : 0
			};
		});

		for (const r of rows) {
			if (r.excluded && r.exclusionReason) {
				warnings.push(`${r.ref.ticker}: пропущен (${r.exclusionReason})`);
			}
		}

		return {
			items,
			totalCurrentValue,
			totalNewValue: finalNewTotal,
			totalSpent: spent,
			leftover,
			warnings
		};
	}
};
