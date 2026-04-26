import { describe, expect, it } from 'vitest';
import { buyOnlyStrategy } from './buyOnly';
import type { RebalanceHolding } from './types';

function h(partial: Partial<RebalanceHolding> & { ticker: string }): RebalanceHolding {
	return {
		shortName: partial.ticker,
		price: 100,
		lotsize: 1,
		quantity: 0,
		targetPercent: 0,
		...partial
	};
}

describe('buyOnlyStrategy', () => {
	it('возвращает пустой результат для пустого портфеля', () => {
		const r = buyOnlyStrategy.compute({ holdings: [], deposit: 1000 });
		expect(r.items).toEqual([]);
		expect(r.totalCurrentValue).toBe(0);
		expect(r.totalSpent).toBe(0);
		expect(r.leftover).toBe(1000);
	});

	it('депозит меньше стоимости одного лота — ничего не покупаем', () => {
		const r = buyOnlyStrategy.compute({
			holdings: [h({ ticker: 'TGLD', price: 14, lotsize: 1, targetPercent: 100 })],
			deposit: 13
		});
		expect(r.items[0].lotsToBuy).toBe(0);
		expect(r.totalSpent).toBe(0);
		expect(r.leftover).toBe(13);
	});

	it('распределяет депозит пропорционально целям при пустом портфеле', () => {
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, targetPercent: 50 }),
				h({ ticker: 'B', price: 100, targetPercent: 50 })
			],
			deposit: 1000
		});
		const a = r.items.find((x) => x.ticker === 'A')!;
		const b = r.items.find((x) => x.ticker === 'B')!;
		expect(a.lotsToBuy).toBe(5);
		expect(b.lotsToBuy).toBe(5);
		expect(r.leftover).toBe(0);
	});

	it('учитывает lotsize > 1 — покупает только целыми лотами', () => {
		const r = buyOnlyStrategy.compute({
			holdings: [h({ ticker: 'SBER', price: 250, lotsize: 10, targetPercent: 100 })],
			deposit: 7000
		});
		// lotCost = 2500, помещается 2 лота на 5000, остаток 2000.
		expect(r.items[0].lotsToBuy).toBe(2);
		expect(r.items[0].qtyToBuy).toBe(20);
		expect(r.totalSpent).toBe(5000);
		expect(r.leftover).toBe(2000);
	});

	it('жадный догон отдаёт остаток самой недобранной позиции', () => {
		// Пустой портфель, цели 60/40, депозит 1000, цены одинаковые.
		// floor дает 6 и 4 — всё ровно.
		// Возьмём цены так, чтобы первичные округления дали остаток.
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, targetPercent: 60 }),
				h({ ticker: 'B', price: 300, targetPercent: 40 })
			],
			deposit: 1000
		});
		// targetValue: A=600, B=400. need=600/400, alloc=600/400.
		// floor: lotsA=6 (600), lotsB=1 (300). spent=900, leftover=100.
		// На остаток 100 ни один лот A (100) ни B (300) не пройдёт через "недобор":
		// после round 1 A на цели → score=0, B недобран (400-300)/400 = 0.25, но lotCost=300 > 100.
		// А вот A: цена 100, lotCost=100, helps? A уже на цели, score=0 → не берём.
		// Итог: leftover=100.
		const a = r.items.find((x) => x.ticker === 'A')!;
		const b = r.items.find((x) => x.ticker === 'B')!;
		expect(a.lotsToBuy).toBe(6);
		expect(b.lotsToBuy).toBe(1);
		expect(r.leftover).toBe(100);
	});

	it('жадный догон срабатывает, когда остаток позволяет ещё один лот', () => {
		// A target 50%, B target 50%, цены 100 и 100, депозит 700.
		// targetValue=350 каждому, floor: 3 лота каждому (=600). leftover=100.
		// На остаток помещается ещё 1 лот по 100. Оба на 300, недобор одинаковый.
		// Берём первый по индексу при равенстве.
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, targetPercent: 50 }),
				h({ ticker: 'B', price: 100, targetPercent: 50 })
			],
			deposit: 700
		});
		const totalLots = r.items.reduce((s, i) => s + i.lotsToBuy, 0);
		expect(totalLots).toBe(7);
		expect(r.leftover).toBe(0);
	});

	it('нормализует цели если их сумма не 100%', () => {
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, targetPercent: 25 }),
				h({ ticker: 'B', price: 100, targetPercent: 25 })
			],
			deposit: 1000
		});
		// 25+25=50; нормализуем до 50/50, оба получают 500 → по 5 лотов.
		expect(r.items[0].lotsToBuy).toBe(5);
		expect(r.items[1].lotsToBuy).toBe(5);
		expect(r.warnings.some((w) => w.includes('100%'))).toBe(true);
	});

	it('исключает позицию с нулевой/отрицательной ценой и предупреждает', () => {
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'BAD', price: 0, targetPercent: 50 }),
				h({ ticker: 'OK', price: 100, targetPercent: 50 })
			],
			deposit: 500
		});
		const bad = r.items.find((x) => x.ticker === 'BAD')!;
		const ok = r.items.find((x) => x.ticker === 'OK')!;
		expect(bad.lotsToBuy).toBe(0);
		expect(ok.lotsToBuy).toBe(5);
		expect(r.warnings.some((w) => w.includes('BAD'))).toBe(true);
	});

	it('не покупает позицию с целью 0%', () => {
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, targetPercent: 0, quantity: 5 }),
				h({ ticker: 'B', price: 100, targetPercent: 100 })
			],
			deposit: 1000
		});
		const a = r.items.find((x) => x.ticker === 'A')!;
		const b = r.items.find((x) => x.ticker === 'B')!;
		expect(a.lotsToBuy).toBe(0);
		expect(b.lotsToBuy).toBe(10);
	});

	it('депозит меньше нехватки — масштабирует пропорционально', () => {
		// Текущая стоимость: A=0, B=0. Цели 50/50, депозит 100.
		// Цены 100 и 100, lotsize=1.
		// targetValue по 100, нехватка 200, depo 100 → alloc по 50.
		// floor=0 каждому. Жадный догон: leftover=100, лот=100. После 1-го лота A: A на цели,
		// B по-прежнему нуль, недобор=1 → берём B. Итог: 0 и 1.
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, targetPercent: 50 }),
				h({ ticker: 'B', price: 100, targetPercent: 50 })
			],
			deposit: 100
		});
		const totalLots = r.items.reduce((s, i) => s + i.lotsToBuy, 0);
		expect(totalLots).toBe(1);
		expect(r.leftover).toBe(0);
	});

	it('учитывает существующие позиции при распределении', () => {
		// Уже куплено 10 шт A по 100 = 1000. Цели 50/50. Депозит 1000.
		// total_new=2000. target по 1000 каждому. need: A=0, B=1000.
		// Весь депозит уйдет в B: 10 лотов.
		const r = buyOnlyStrategy.compute({
			holdings: [
				h({ ticker: 'A', price: 100, quantity: 10, targetPercent: 50 }),
				h({ ticker: 'B', price: 100, targetPercent: 50 })
			],
			deposit: 1000
		});
		const a = r.items.find((x) => x.ticker === 'A')!;
		const b = r.items.find((x) => x.ticker === 'B')!;
		expect(a.lotsToBuy).toBe(0);
		expect(b.lotsToBuy).toBe(10);
		expect(b.newPercent).toBeCloseTo(50, 1);
	});
});
