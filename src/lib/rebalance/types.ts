export interface RebalanceInput {
	holdings: RebalanceHolding[];
	deposit: number;
}

export interface RebalanceHolding {
	ticker: string;
	shortName: string;
	displayName: string;
	price: number;
	lotsize: number;
	quantity: number;
	targetPercent: number;
}

export interface RebalanceItem {
	ticker: string;
	shortName: string;
	displayName: string;
	price: number;
	lotsize: number;
	currentQty: number;
	currentValue: number;
	currentPercent: number;
	targetPercent: number;
	targetValue: number;
	lotsToBuy: number;
	qtyToBuy: number;
	spend: number;
	newQty: number;
	newValue: number;
	newPercent: number;
}

export interface RebalanceResult {
	items: RebalanceItem[];
	totalCurrentValue: number;
	totalNewValue: number;
	totalSpent: number;
	leftover: number;
	warnings: string[];
}

export interface RebalanceStrategy {
	readonly id: 'buy-only' | 'buy-sell';
	compute(input: RebalanceInput): RebalanceResult;
}
