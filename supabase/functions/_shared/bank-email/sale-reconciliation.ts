const BANK_PAYMENT_METHODS = new Set([
  'bancolombia',
  'transferencia',
  'transferencia bancaria',
  'llave'
]);

export function isBankReconciliationPaymentMethod(name: unknown): boolean {
  return typeof name === 'string' && BANK_PAYMENT_METHODS.has(name.trim().toLowerCase());
}
