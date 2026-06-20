import { dayBounds, millisToHours, toIsoDate } from "./date.js";
import type { WhoopClient } from "./whoop-client.js";

type JsonObject = Record<string, unknown>;

export interface RecoverySummary {
  recoveryScore: number | null;
  hrvRmssdMilli: number | null;
  restingHeartRate: number | null;
  spo2Percentage: number | null;
  skinTempCelsius: number | null;
  status: string | null;
}

export interface SleepSummary {
  sleepId: string | null;
  sleepHours: number | null;
  inBedHours: number | null;
  awakeHours: number | null;
  lightSleepHours: number | null;
  slowWaveSleepHours: number | null;
  remSleepHours: number | null;
  disturbances: number | null;
  respiratoryRate: number | null;
  sleepPerformancePercentage: number | null;
  sleepEfficiencyPercentage: number | null;
  sleepConsistencyPercentage: number | null;
  status: string | null;
}

export interface CycleSummary {
  cycleId: number | string | null;
  strain: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  kilojoule: number | null;
  status: string | null;
}

export interface WorkoutSummary {
  id: string | null;
  sportName: string | null;
  start: string | null;
  end: string | null;
  strain: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
}

export interface WhoopSnapshot {
  date: string;
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  recovery: RecoverySummary;
  sleep: SleepSummary;
  cycle: CycleSummary;
  workouts: WorkoutSummary[];
  recommendation: WorkloadRecommendation;
  raw?: {
    profile?: JsonObject;
    cycle?: JsonObject | null;
    recovery?: JsonObject | null;
    sleep?: JsonObject | null;
    workouts?: JsonObject[];
  };
}

export interface WorkloadRecommendation {
  load: "normal" | "reduced" | "minimal" | "recovery";
  ticketLimit: number;
  message: string;
  reasons: string[];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function firstRecord(response: { records?: JsonObject[] } | null): JsonObject | null {
  return response?.records?.[0] ?? null;
}

function sleepDurationHours(stageSummary: JsonObject): number | null {
  const light = numberOrNull(stageSummary.total_light_sleep_time_milli) ?? 0;
  const slowWave = numberOrNull(stageSummary.total_slow_wave_sleep_time_milli) ?? 0;
  const rem = numberOrNull(stageSummary.total_rem_sleep_time_milli) ?? 0;
  const total = light + slowWave + rem;
  return total > 0 ? millisToHours(total) : null;
}

export function summarizeRecovery(recovery: JsonObject | null): RecoverySummary {
  const score = objectOrNull(recovery?.score) ?? {};

  return {
    recoveryScore: numberOrNull(score.recovery_score),
    hrvRmssdMilli: numberOrNull(score.hrv_rmssd_milli),
    restingHeartRate: numberOrNull(score.resting_heart_rate),
    spo2Percentage: numberOrNull(score.spo2_percentage),
    skinTempCelsius: numberOrNull(score.skin_temp_celsius),
    status: stringOrNull(recovery?.score_state),
  };
}

export function summarizeSleep(sleep: JsonObject | null): SleepSummary {
  const score = objectOrNull(sleep?.score) ?? {};
  const stageSummary = objectOrNull(score.stage_summary) ?? {};

  return {
    sleepId: stringOrNull(sleep?.id),
    sleepHours: sleepDurationHours(stageSummary),
    inBedHours: millisToHours(stageSummary.total_in_bed_time_milli),
    awakeHours: millisToHours(stageSummary.total_awake_time_milli),
    lightSleepHours: millisToHours(stageSummary.total_light_sleep_time_milli),
    slowWaveSleepHours: millisToHours(stageSummary.total_slow_wave_sleep_time_milli),
    remSleepHours: millisToHours(stageSummary.total_rem_sleep_time_milli),
    disturbances: numberOrNull(stageSummary.disturbance_count),
    respiratoryRate: numberOrNull(score.respiratory_rate),
    sleepPerformancePercentage: numberOrNull(score.sleep_performance_percentage),
    sleepEfficiencyPercentage: numberOrNull(score.sleep_efficiency_percentage),
    sleepConsistencyPercentage: numberOrNull(score.sleep_consistency_percentage),
    status: stringOrNull(sleep?.score_state),
  };
}

export function summarizeCycle(cycle: JsonObject | null): CycleSummary {
  const score = objectOrNull(cycle?.score) ?? {};

  return {
    cycleId: numberOrNull(cycle?.id) ?? stringOrNull(cycle?.id),
    strain: numberOrNull(score.strain),
    averageHeartRate: numberOrNull(score.average_heart_rate),
    maxHeartRate: numberOrNull(score.max_heart_rate),
    kilojoule: numberOrNull(score.kilojoule),
    status: stringOrNull(cycle?.score_state),
  };
}

export function summarizeWorkout(workout: JsonObject): WorkoutSummary {
  const score = objectOrNull(workout.score) ?? {};

  return {
    id: stringOrNull(workout.id),
    sportName: stringOrNull(workout.sport_name),
    start: stringOrNull(workout.start),
    end: stringOrNull(workout.end),
    strain: numberOrNull(score.strain),
    averageHeartRate: numberOrNull(score.average_heart_rate),
    maxHeartRate: numberOrNull(score.max_heart_rate),
  };
}

export function recommendWorkload(snapshot: Omit<WhoopSnapshot, "recommendation">): WorkloadRecommendation {
  const reasons: string[] = [];
  let risk = 0;

  if (snapshot.sleep.sleepHours !== null && snapshot.sleep.sleepHours < 5) {
    risk += 3;
    reasons.push(`sleep was ${snapshot.sleep.sleepHours}h`);
  } else if (snapshot.sleep.sleepHours !== null && snapshot.sleep.sleepHours < 6.5) {
    risk += 1;
    reasons.push(`sleep was only ${snapshot.sleep.sleepHours}h`);
  }

  if (snapshot.sleep.sleepPerformancePercentage !== null && snapshot.sleep.sleepPerformancePercentage < 60) {
    risk += 2;
    reasons.push(`sleep performance is ${snapshot.sleep.sleepPerformancePercentage}%`);
  }

  if (snapshot.recovery.recoveryScore !== null && snapshot.recovery.recoveryScore < 34) {
    risk += 3;
    reasons.push(`WHOOP recovery is red at ${snapshot.recovery.recoveryScore}%`);
  } else if (snapshot.recovery.recoveryScore !== null && snapshot.recovery.recoveryScore < 67) {
    risk += 1;
    reasons.push(`WHOOP recovery is yellow at ${snapshot.recovery.recoveryScore}%`);
  }

  if (snapshot.cycle.strain !== null && snapshot.cycle.strain > 14) {
    risk += 1;
    reasons.push(`day strain is already ${snapshot.cycle.strain}`);
  }

  if (snapshot.recovery.restingHeartRate !== null && snapshot.recovery.restingHeartRate > 70) {
    risk += 1;
    reasons.push(`resting heart rate is ${snapshot.recovery.restingHeartRate}`);
  }

  if (risk >= 6) {
    return {
      load: "recovery",
      ticketLimit: 1,
      message: "Recovery signals are weak. Take one small, low-risk task and postpone deep or irreversible work.",
      reasons,
    };
  }

  if (risk >= 4) {
    return {
      load: "minimal",
      ticketLimit: 2,
      message: "Keep scope tight today. Do one or two tickets, avoid late-day expansion, and leave complex work queued.",
      reasons,
    };
  }

  if (risk >= 2) {
    return {
      load: "reduced",
      ticketLimit: 3,
      message: "Use a reduced plan: prioritize the highest-value tasks and add explicit stopping points.",
      reasons,
    };
  }

  return {
    load: "normal",
    ticketLimit: 5,
    message: "Recovery signals look workable. Keep normal planning, with breaks and a clear end condition.",
    reasons: reasons.length > 0 ? reasons : ["no major recovery warning signals found"],
  };
}

export async function getWellbeingSnapshot(
  whoop: WhoopClient,
  date: Date,
  includeRaw = false,
): Promise<WhoopSnapshot> {
  const bounds = dayBounds(date);
  const dateIso = toIsoDate(date);

  const [profile, cycles, recoveries, sleeps, workouts] = await Promise.all([
    whoop.getProfile().catch(() => null),
    whoop.getCycles({ ...bounds, limit: 10 }).catch(() => null),
    whoop.getRecoveries({ ...bounds, limit: 10 }).catch(() => null),
    whoop.getSleeps({ ...bounds, limit: 10 }).catch(() => null),
    whoop.getWorkouts({ ...bounds, limit: 25 }).catch(() => ({ records: [] })),
  ]);

  const cycle = firstRecord(cycles);
  const recovery = firstRecord(recoveries);
  const sleep = firstRecord(sleeps);

  const withoutRecommendation = {
    date: dateIso,
    profile: profile
      ? {
          firstName: stringOrNull(profile.first_name),
          lastName: stringOrNull(profile.last_name),
          email: stringOrNull(profile.email),
        }
      : null,
    recovery: summarizeRecovery(recovery),
    sleep: summarizeSleep(sleep),
    cycle: summarizeCycle(cycle),
    workouts: (workouts.records ?? []).map(summarizeWorkout),
    ...(includeRaw
      ? {
          raw: {
            ...(profile ? { profile } : {}),
            cycle,
            recovery,
            sleep,
            workouts: workouts.records ?? [],
          },
        }
      : {}),
  };

  return {
    ...withoutRecommendation,
    recommendation: recommendWorkload(withoutRecommendation),
  };
}
