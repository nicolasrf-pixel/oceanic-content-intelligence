/**
 * Presupuesto de subsolicitudes por invocación. El plan gratuito de Workers permite 50 (D1, fetch y Workers AI cuentan);
 * el de pago, 1000. El Coordinador consulta el saldo antes de cada paso y, si no alcanza, se detiene limpiamente:
 * lo pendiente se retoma en el siguiente cron horario.
 */
let used = 0;
let limit = 45;

export function resetBudget(max?: string | number) {
  used = 0;
  const n = Number(max);
  limit = Number.isFinite(n) && n >= 20 ? Math.floor(n) : 45;
}
export function spend(n = 1) { used += n; }
export function remaining() { return limit - used; }
export const COST = { account: 14, publication: 22 } as const;
