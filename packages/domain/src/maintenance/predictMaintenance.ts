const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OdometerReading {
  odometerKm: number;
  /** ISO 8601 */
  recordedAt: string;
}

export interface MaintenancePrediction {
  /** ISO 8601. null when there isn't enough history, no service is scheduled, or the vehicle shows no recent usage. */
  estimatedServiceDate: string | null;
  /** null alongside estimatedServiceDate above. */
  averageKmPerDay: number | null;
  daysUntilService: number | null;
  /** true when the vehicle is already overdue, or the estimated service date falls within config.dueSoonDays. */
  dueSoon: boolean;
  reasons: string[];
}

export interface MaintenancePredictionConfig {
  /** Window (in days) before the estimated service date at which the vehicle is flagged "due soon". Organization-configurable. */
  dueSoonDays: number;
}

export const defaultMaintenancePredictionConfig: MaintenancePredictionConfig = {
  dueSoonDays: 14,
};

/**
 * "Predictive Maintenance" (fleet-car-saas.txt §12): "Com base no km registrado nos
 * check-ins e no histórico de utilização, a plataforma poderá prever quando determinado
 * veículo atingirá sua próxima revisão" — e.g. odometer 18.900km, next service 20.000km,
 * historical average 110 km/dia → the platform estimates the date it'll hit 20.000km and
 * looks for a maintenance window ("O Fleet Manager recebe recomendação para agendamento").
 * This is explicitly a forecast, not a guarantee, so every result carries its basis
 * (averageKmPerDay, reasons) alongside the estimate rather than a bare date.
 */
export function predictNextService(
  currentOdometerKm: number,
  nextServiceOdometerKm: number | null,
  history: OdometerReading[],
  now: string,
  config: MaintenancePredictionConfig,
): MaintenancePrediction {
  if (nextServiceOdometerKm === null) {
    return {
      estimatedServiceDate: null,
      averageKmPerDay: null,
      daysUntilService: null,
      dueSoon: false,
      reasons: ["no_service_scheduled"],
    };
  }

  const remainingKm = nextServiceOdometerKm - currentOdometerKm;
  if (remainingKm <= 0) {
    return {
      estimatedServiceDate: now,
      averageKmPerDay: computeAverageKmPerDay(history),
      daysUntilService: 0,
      dueSoon: true,
      reasons: ["already_overdue"],
    };
  }

  const averageKmPerDay = computeAverageKmPerDay(history);
  if (averageKmPerDay === null) {
    return {
      estimatedServiceDate: null,
      averageKmPerDay: null,
      daysUntilService: null,
      dueSoon: false,
      reasons: ["insufficient_history"],
    };
  }

  if (averageKmPerDay <= 0) {
    return {
      estimatedServiceDate: null,
      averageKmPerDay,
      daysUntilService: null,
      dueSoon: false,
      reasons: ["no_recent_usage"],
    };
  }

  const daysUntilService = remainingKm / averageKmPerDay;
  const estimatedServiceDate = new Date(
    new Date(now).getTime() + daysUntilService * MS_PER_DAY,
  ).toISOString();
  const dueSoon = daysUntilService <= config.dueSoonDays;
  const reasons = ["estimate_based_on_recent_usage"];
  if (dueSoon) {
    reasons.push("maintenance_due_soon");
  }

  return {
    estimatedServiceDate,
    averageKmPerDay,
    daysUntilService,
    dueSoon,
    reasons,
  };
}

/**
 * Averaging approach: total km driven / total days spanned between the earliest and latest
 * readings in the history (not a recency-weighted rate) — matches the spec's own "média
 * histórica" example and avoids overfitting to any single short interval.
 */
function computeAverageKmPerDay(history: OdometerReading[]): number | null {
  if (history.length < 2) {
    return null;
  }

  const sorted = [...history].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  const earliest = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const spanDays = (new Date(latest.recordedAt).getTime() - new Date(earliest.recordedAt).getTime()) / MS_PER_DAY;

  if (spanDays <= 0) {
    return null;
  }

  return (latest.odometerKm - earliest.odometerKm) / spanDays;
}
