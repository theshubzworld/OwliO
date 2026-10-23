export interface CloudConfig {
  supabaseUrl: string;
  publishableKey: string;
}
export interface AccountStatus {
  configured: boolean;
  user: { id: string; email?: string } | null;
  signingIn: boolean;
  emailLinkPending?: boolean;
  error?: string;
  access?: {
    blocked: boolean;
    reason?: string;
    checkedAt?: number;
    offline?: boolean;
    termsAccepted?: boolean;
    termsVersion?: string;
    privacyVersion?: string;
    policyHash?: string;
    acceptedAt?: string;
  };
}
export interface AdminAccount {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  blocked: boolean;
  reason: string;
  administrator: boolean;
}
export type MetricStage =
  'speech' | 'romanization' | 'cleanup' | 'rewrite' | 'insertion' | 'meeting';
export interface AnalyticsStatus {
  configured: boolean;
  enabled: boolean;
  queued: number;
  lastSentAt?: number;
}
export interface AdminMetrics {
  days: number;
  installations: number;
  activeToday: number;
  activeInPeriod: number;
  accounts: number;
  successfulDictations: number;
  failedDictations: number;
  audioMinutes: number;
  words: number;
  setupCompletions: number;
  activatedInstallations: number;
  daily: {
    day: string;
    active: number;
    dictations: number;
    failures: number;
  }[];
  stages: { stage: string; total: number; failed: number; averageMs: number }[];
  models: { model: string; count: number }[];
  languages: { language: string; count: number }[];
  versions: { version: string; count: number }[];
}
