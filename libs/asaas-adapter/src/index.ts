/**
 * `@aurum/asaas-adapter` — porta + adapter Asaas (Sandbox-first).
 * Billing core depende da PORTA (`BillingProviderPort`), nunca do concreto.
 */
export * from './config';
export * from './port';
export * from './bill-payments';
export * from './adapter';
