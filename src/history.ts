import { addDays, dateRangeEndingOn, toIsoDate } from "./date.js";
import type { WhoopClient } from "./whoop-client.js";
import { getWellbeingSnapshot } from "./wellbeing.js";

interface HistoricalMetricDay {
  date: string;
  sleepHours: number | null;
  sleepPerformancePercentage: number | null;
  recoveryScore: number | null;
  hrvRmssdMilli: number | null;
  restingHeartRate: number | null;
  dayStrain: number | null;
}

interface MetricSummary {
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  sampleCount: number;
}

interface TrendMetric {
  averageShortWindow: number | null;
  averageLongWindow: number | null;
  previousShortWindowAverage: number | null;
  deltaVsPreviousShortWindow: number | null;
  trend: "up" | "down" | "flat" | "unknown";
}

export interface TrainingLoadTrend {
  date: string;
  windows: {
    shortDays: number;
    longDays: number;
  };
  sampleCoverage: {
    shortWindowDays: number;
    longWindowDays: number;
  };
  metrics: {
    sleepHours: TrendMetric;
    sleepPerformancePercentage: TrendMetric;
    recoveryScore: TrendMetric;
    hrvRmssdMilli: TrendMetric;
    restingHeartRate: TrendMetric;
    dayStrain: TrendMetric;
  };
  interpretation: string;
}

export interface BaselineMetricProfile extends MetricSummary {
  lowerQuartile: number | null;
  upperQuartile: number | null;
}

export interface BaselineProfile {
  date: string;
  windowDays: number;
  sampleCount: number;
  metrics: {
    sleepHours: BaselineMetricProfile;
    sleepPerformancePercentage: BaselineMetricProfile;
    recoveryScore: BaselineMetricProfile;
    hrvRmssdMilli: BaselineMetricProfile;
    restingHeartRate: BaselineMetricProfile;
    dayStrain: BaselineMetricProfile;
  };
}

export interface ChangeAlert {
  metric: string;
  severity: "info" | "warning" | "critical";
  direction: "up" | "down";
  summary: string;
}

export interface ChangeAlertsReport {
  date: string;
  comparisonDate: string;
  baselineWindowDays: number;
  current: HistoricalMetricDay;
  previous: HistoricalMetricDay | null;
  baseline: BaselineProfile;
  alerts: ChangeAlert[];
}

function round(value: number | null, digits = 1): number | null {
  if (value === null) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sortedValues: number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = (sortedValues.length - 1) * ratio;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];

  if (lower === undefined || upper === undefined) {
    return null;
  }

  return lowerIndex === upperIndex ? lower : lower + (upper - lower) * (index - lowerIndex);
}

function summarizeMetric(values: Array<number | null>): MetricSummary {
  const clean = values.filter((value): value is number => value !== null).sort((left, right) => left - right);
  return {
    average: round(average(clean)),
    minimum: clean.length > 0 ? round(clean[0]) : null,
    maximum: clean.length > 0 ? round(clean[clean.length - 1]) : null,
    sampleCount: clean.length,
  };
}

function summarizeBaselineMetric(values: Array<number | null>): BaselineMetricProfile {
  const clean = values.filter((value): value is number => value !== null).sort((left, right) => left - right);
  const summary = summarizeMetric(values);

  return {
    ...summary,
    lowerQuartile: round(quantile(clean, 0.25)),
    upperQuartile: round(quantile(clean, 0.75)),
  };
}

function compareDirection(
  currentValue: number | null,
  previousValue: number | null,
): "up" | "down" | "flat" | "unknown" {
  if (currentValue === null || previousValue === null) {
    return "unknown";
  }

  const delta = currentValue - previousValue;
  if (Math.abs(delta) < 0.1) {
    return "flat";
  }

  return delta > 0 ? "up" : "down";
}

function buildTrendMetric(
  recentValues: Array<number | null>,
  longValues: Array<number | null>,
  previousValues: Array<number | null>,
): TrendMetric {
  const averageShortWindow = summarizeMetric(recentValues).average;
  const averageLongWindow = summarizeMetric(longValues).average;
  const previousShortWindowAverage = summarizeMetric(previousValues).average;
  const delta =
    averageShortWindow !== null && previousShortWindowAverage !== null
      ? round(averageShortWindow - previousShortWindowAverage)
      : null;

  return {
    averageShortWindow,
    averageLongWindow,
    previousShortWindowAverage,
    deltaVsPreviousShortWindow: delta,
    trend: compareDirection(averageShortWindow, previousShortWindowAverage),
  };
}

function describeTrend(metricLabel: string, metric: TrendMetric, higherIsBetter: boolean): string | null {
  if (metric.trend === "unknown" || metric.deltaVsPreviousShortWindow === null) {
    return null;
  }

  if (metric.trend === "flat") {
    return `${metricLabel} is stable versus the previous week`;
  }

  const movedPositive = metric.deltaVsPreviousShortWindow > 0;
  const favorable = higherIsBetter ? movedPositive : !movedPositive;
  const directionWord = favorable ? "improving" : "worsening";

  return `${metricLabel} is ${directionWord} versus the previous week`;
}

function buildInterpretation(metrics: TrainingLoadTrend["metrics"]): string {
  const parts = [
    describeTrend("sleep", metrics.sleepHours, true),
    describeTrend("sleep performance", metrics.sleepPerformancePercentage, true),
    describeTrend("recovery", metrics.recoveryScore, true),
    describeTrend("HRV", metrics.hrvRmssdMilli, true),
    describeTrend("resting heart rate", metrics.restingHeartRate, false),
    describeTrend("strain", metrics.dayStrain, false),
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return "Trend data is incomplete. WHOOP did not return enough historical samples to infer direction.";
  }

  return parts.join("; ") + ".";
}

async function fetchHistoricalMetricDay(whoop: WhoopClient, date: Date): Promise<HistoricalMetricDay> {
  const snapshot = await getWellbeingSnapshot(whoop, date, false);

  return {
    date: snapshot.date,
    sleepHours: snapshot.sleep.sleepHours,
    sleepPerformancePercentage: snapshot.sleep.sleepPerformancePercentage,
    recoveryScore: snapshot.recovery.recoveryScore,
    hrvRmssdMilli: snapshot.recovery.hrvRmssdMilli,
    restingHeartRate: snapshot.recovery.restingHeartRate,
    dayStrain: snapshot.cycle.strain,
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export async function getHistoricalMetricDays(
  whoop: WhoopClient,
  endDate: Date,
  days: number,
): Promise<HistoricalMetricDay[]> {
  const dates = dateRangeEndingOn(endDate, days);
  return mapWithConcurrency(dates, 3, (date) => fetchHistoricalMetricDay(whoop, date));
}

export async function getTrainingLoadTrend(
  whoop: WhoopClient,
  date: Date,
  shortDays = 7,
  longDays = 28,
): Promise<TrainingLoadTrend> {
  if (longDays < shortDays) {
    throw new Error("The long trend window must be greater than or equal to the short trend window.");
  }

  const history = await getHistoricalMetricDays(whoop, date, longDays);
  const shortWindow = history.slice(-shortDays);
  const previousShortWindow = history.slice(Math.max(0, history.length - shortDays * 2), history.length - shortDays);

  const metrics = {
    sleepHours: buildTrendMetric(
      shortWindow.map((entry) => entry.sleepHours),
      history.map((entry) => entry.sleepHours),
      previousShortWindow.map((entry) => entry.sleepHours),
    ),
    sleepPerformancePercentage: buildTrendMetric(
      shortWindow.map((entry) => entry.sleepPerformancePercentage),
      history.map((entry) => entry.sleepPerformancePercentage),
      previousShortWindow.map((entry) => entry.sleepPerformancePercentage),
    ),
    recoveryScore: buildTrendMetric(
      shortWindow.map((entry) => entry.recoveryScore),
      history.map((entry) => entry.recoveryScore),
      previousShortWindow.map((entry) => entry.recoveryScore),
    ),
    hrvRmssdMilli: buildTrendMetric(
      shortWindow.map((entry) => entry.hrvRmssdMilli),
      history.map((entry) => entry.hrvRmssdMilli),
      previousShortWindow.map((entry) => entry.hrvRmssdMilli),
    ),
    restingHeartRate: buildTrendMetric(
      shortWindow.map((entry) => entry.restingHeartRate),
      history.map((entry) => entry.restingHeartRate),
      previousShortWindow.map((entry) => entry.restingHeartRate),
    ),
    dayStrain: buildTrendMetric(
      shortWindow.map((entry) => entry.dayStrain),
      history.map((entry) => entry.dayStrain),
      previousShortWindow.map((entry) => entry.dayStrain),
    ),
  };

  return {
    date: toIsoDate(date),
    windows: {
      shortDays,
      longDays,
    },
    sampleCoverage: {
      shortWindowDays: shortWindow.length,
      longWindowDays: history.length,
    },
    metrics,
    interpretation: buildInterpretation(metrics),
  };
}

export async function getBaselineProfile(
  whoop: WhoopClient,
  date: Date,
  windowDays = 42,
): Promise<BaselineProfile> {
  const history = await getHistoricalMetricDays(whoop, date, windowDays);

  return {
    date: toIsoDate(date),
    windowDays,
    sampleCount: history.length,
    metrics: {
      sleepHours: summarizeBaselineMetric(history.map((entry) => entry.sleepHours)),
      sleepPerformancePercentage: summarizeBaselineMetric(history.map((entry) => entry.sleepPerformancePercentage)),
      recoveryScore: summarizeBaselineMetric(history.map((entry) => entry.recoveryScore)),
      hrvRmssdMilli: summarizeBaselineMetric(history.map((entry) => entry.hrvRmssdMilli)),
      restingHeartRate: summarizeBaselineMetric(history.map((entry) => entry.restingHeartRate)),
      dayStrain: summarizeBaselineMetric(history.map((entry) => entry.dayStrain)),
    },
  };
}

function formatNumber(value: number | null): string {
  return value === null ? "unknown" : String(round(value));
}

function createAlert(
  metric: string,
  severity: "info" | "warning" | "critical",
  direction: "up" | "down",
  summary: string,
): ChangeAlert {
  return { metric, severity, direction, summary };
}

function collectAlerts(
  current: HistoricalMetricDay,
  previous: HistoricalMetricDay | null,
  baseline: BaselineProfile,
): ChangeAlert[] {
  const currentHasRecoveryData = [
    current.sleepHours,
    current.sleepPerformancePercentage,
    current.recoveryScore,
    current.hrvRmssdMilli,
    current.restingHeartRate,
    current.dayStrain,
  ].some((value) => value !== null);

  if (!currentHasRecoveryData) {
    return [
      createAlert(
        "overall",
        "info",
        "up",
        "WHOOP has not populated recovery data for this date yet. Compare again after sleep/recovery sync completes.",
      ),
    ];
  }

  const alerts: ChangeAlert[] = [];

  const previousSleep = previous?.sleepHours ?? null;
  if (current.sleepHours !== null && previousSleep !== null) {
    const sleepDrop = current.sleepHours - previousSleep;
    if (sleepDrop <= -1.5) {
      alerts.push(
        createAlert(
          "sleepHours",
          sleepDrop <= -2.5 ? "critical" : "warning",
          "down",
          `Sleep dropped from ${formatNumber(previousSleep)}h to ${formatNumber(current.sleepHours)}h versus yesterday.`,
        ),
      );
    }
  }

  const baselineRecovery = baseline.metrics.recoveryScore.average;
  if (current.recoveryScore !== null && baselineRecovery !== null && current.recoveryScore <= baselineRecovery - 15) {
    alerts.push(
      createAlert(
        "recoveryScore",
        current.recoveryScore <= baselineRecovery - 25 ? "critical" : "warning",
        "down",
        `WHOOP recovery is ${formatNumber(baselineRecovery - current.recoveryScore)} points below baseline.`,
      ),
    );
  }

  const baselineHrv = baseline.metrics.hrvRmssdMilli.average;
  if (current.hrvRmssdMilli !== null && baselineHrv !== null && current.hrvRmssdMilli <= baselineHrv - 8) {
    alerts.push(
      createAlert(
        "hrvRmssdMilli",
        current.hrvRmssdMilli <= baselineHrv - 12 ? "critical" : "warning",
        "down",
        `HRV is ${formatNumber(baselineHrv - current.hrvRmssdMilli)} ms below baseline.`,
      ),
    );
  }

  const baselineRhr = baseline.metrics.restingHeartRate.average;
  if (current.restingHeartRate !== null && baselineRhr !== null && current.restingHeartRate >= baselineRhr + 8) {
    alerts.push(
      createAlert(
        "restingHeartRate",
        current.restingHeartRate >= baselineRhr + 12 ? "critical" : "warning",
        "up",
        `Resting heart rate is ${formatNumber(current.restingHeartRate - baselineRhr)} bpm above baseline.`,
      ),
    );
  }

  const baselineSleepPerformance = baseline.metrics.sleepPerformancePercentage.average;
  if (
    current.sleepPerformancePercentage !== null &&
    baselineSleepPerformance !== null &&
    current.sleepPerformancePercentage <= baselineSleepPerformance - 15
  ) {
    alerts.push(
      createAlert(
        "sleepPerformancePercentage",
        current.sleepPerformancePercentage <= baselineSleepPerformance - 25 ? "critical" : "warning",
        "down",
        `Sleep performance is ${formatNumber(baselineSleepPerformance - current.sleepPerformancePercentage)} points below baseline.`,
      ),
    );
  }

  if (alerts.length === 0) {
    alerts.push(
      createAlert(
        "overall",
        "info",
        "up",
        "No major WHOOP recovery changes detected versus yesterday or your baseline window.",
      ),
    );
  }

  return alerts;
}

export async function getChangeAlerts(
  whoop: WhoopClient,
  date: Date,
  baselineWindowDays = 28,
): Promise<ChangeAlertsReport> {
  const current = await fetchHistoricalMetricDay(whoop, date);
  const previousDate = addDays(date, -1);
  const previous = await fetchHistoricalMetricDay(whoop, previousDate).catch(() => null);
  const baselineEndDate = addDays(date, -1);
  const baseline = await getBaselineProfile(whoop, baselineEndDate, baselineWindowDays);

  return {
    date: toIsoDate(date),
    comparisonDate: toIsoDate(previousDate),
    baselineWindowDays,
    current,
    previous,
    baseline,
    alerts: collectAlerts(current, previous, baseline),
  };
}
