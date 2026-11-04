export interface Money {
  amountMinor: number;
  currency: string;
}

export function formatMoney(amountMinor: number, currency = "USD"): string {
  const major = (amountMinor / 100).toFixed(2);
  return `${currency} ${major}`;
}

export function parseMoneyToMinor(amountMajor: string | number): number {
  if (typeof amountMajor === "number") {
    return Math.round(amountMajor * 100);
  }
  const parsed = parseFloat(amountMajor);
  if (isNaN(parsed)) {
    throw new Error(`Invalid amount string: ${amountMajor}`);
  }
  return Math.round(parsed * 100);
}

export function minorToMajorString(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}
