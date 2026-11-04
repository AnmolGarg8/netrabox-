export function minorToPayPalDecimal(amountMinor: number): string {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`Amount in minor units must be a non-negative integer, got: ${amountMinor}`);
  }
  return (amountMinor / 100).toFixed(2);
}

export function payPalDecimalToMinor(amountDecimal: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(amountDecimal)) {
    throw new Error(`Invalid PayPal decimal amount format: '${amountDecimal}'`);
  }
  const parsed = parseFloat(amountDecimal);
  if (isNaN(parsed)) {
    throw new Error(`Cannot parse amount to float: '${amountDecimal}'`);
  }
  return Math.round(parsed * 100);
}

export function validateCurrency(currency: string): string {
  const normalized = currency.toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Invalid ISO 4217 currency code: '${currency}'`);
  }
  return normalized;
}
