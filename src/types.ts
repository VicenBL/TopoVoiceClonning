export type ServiceStatus = 'stopped' | 'starting' | 'active' | 'stopping' | 'error' | 'connecting' | 'unavailable';
export type EngineStatus = 'available' | 'not_configured' | 'error' | 'offline';
export type EngineKind = 'cloning' | 'tts' | 'both';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'error' | 'cancelled';
export type EmotionalMode = 'literal' | 'creative' | 'minimal_rewrite_experimental';

export interface EngineCapabilities {
  operations: Array<'clone' | 'tts'>;
  maxReferences: number;
  minDurationSec: number;
  maxDurationSec: number;
  transcription: 'required' | 'optional' | 'unsupported';
  languages: string[];
  emotionalTags: string[];
  controls: string[];
  audioFormats: string[];
  limitations: string[];
  providerVersion: string;
  dynamicSettings: Array<{ key: string; label: string; type: 'range' | 'select' | 'text' | 'toggle'; options?: string[]; min?: number; max?: number; defaultValue: string | number | boolean }>;
}
export interface Engine { id: string; name: string; kind: EngineKind; locality: 'local' | 'remote' | 'simulated'; status: EngineStatus; version: string; description: string; capabilities: EngineCapabilities; configFields: Array<{ key: string; label: string; type: 'text' | 'password' | 'path' | 'number'; placeholder: string; futureOnly?: boolean }>; }
export interface VoiceVersion { id: string; label: string; createdAt: string; engineId: string; externalReferenceId: string; notes: string; status: 'ready' | 'experimental' | 'error'; sampleReferenceIds: string[]; language?: string; }
export interface Voice { id: string; displayName: string; streamerAlias: string; avatar: string; description?: string; enabledForStreamerBot: boolean; activeVersionId: string; versions: VoiceVersion[]; }
export interface AudioReference { id: string; name: string; durationSec: number; format: string; transcript?: string; quality: 'excellent' | 'good' | 'warning'; engineHint?: string; source: 'upload' | 'recording' | 'library'; }
export interface EmotionalProfile { id: string; name: string; mode: EmotionalMode; freedom: number; active: boolean; provider: string; }
export interface InterpretationPlan { id: string; originalText: string; mode: EmotionalMode; engineId: string; steps: string[]; adaptedInstructions: string[]; unsupported: string[]; simulated: true; }
export interface GenerationRequest { id: string; origin: 'Streamer.bot demo' | 'Laboratorio TTS' | 'Clonación demo' | 'Director emocional'; voiceId: string; versionId: string; engineId: string; originalText: string; emotionalMode: EmotionalMode; emotionalDirectorEnabled: boolean; createdAt: string; engineParameters?: Record<string, string | number | boolean>; emotionalProfileId?: string; interpretationPlanId?: string; comparisonSide?: 'A' | 'B'; comparisonId?: string; simulatedError?: string; }
export interface GenerationResult { durationSec?: number; processingMs?: number; demoAudioLabel?: string; saved?: boolean; }
export interface JobEvent { id: string; jobId: string; at: string; stage: string; summary: string; technicalDetail: string; level: 'info' | 'warning' | 'error'; simulated: true; }
export interface GenerationJob { id: string; order: number; request: GenerationRequest; status: JobStatus; startedAt?: string; completedAt?: string; result?: GenerationResult; error?: { summary: string; stage: string; technicalDetail: string }; events: JobEvent[]; snapshot: { voiceName: string; versionLabel: string; versionEngineId?: string; engineName: string; productionEngineId: string; activeVersionIdAtStart: string; emotionalMode: EmotionalMode; emotionalDirectorEnabled: boolean; engineParameters: Record<string, string | number | boolean>; emotionalProfileId?: string; compatibility: 'compatible' | 'different_provider' | 'engine_unavailable'; }; }
export interface ApplicationSettings { service: { status: ServiceStatus; host: string; port: number; autoStart: boolean; keepRunningOnClose: boolean }; production: { ttsEngineId: string; emotionalDirectorEnabled: boolean; emotionalProfileId: string }; general: { storageFolder: string; audioOutput: string; historyRetentionDays: number; diagnosticsVerbose: boolean }; }
