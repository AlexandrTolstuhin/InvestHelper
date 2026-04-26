import { buyOnlyStrategy } from './buyOnly';
import type { RebalanceStrategy } from './types';

export type StrategyId = RebalanceStrategy['id'];

const strategies: Record<StrategyId, RebalanceStrategy> = {
	'buy-only': buyOnlyStrategy,
	// На будущее: реализация продаж — реализуется как отдельный модуль
	// и регистрируется здесь без изменений вызывающего кода.
	'buy-sell': buyOnlyStrategy
};

export function getStrategy(id: StrategyId): RebalanceStrategy {
	return strategies[id];
}

export { buyOnlyStrategy } from './buyOnly';
export * from './types';
