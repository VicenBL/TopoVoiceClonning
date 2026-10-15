import type { ApplicationSettings, AudioReference, EmotionalProfile, Engine, GenerationJob, Voice } from './types';

export const nowIso = () => new Date().toISOString();

export const demoEngines: Engine[] = [
  {
    id: 'fish-sim', name: 'Fish Audio — demo', kind: 'both', locality: 'simulated', status: 'available', version: 'Sim 1.0',
    description: 'Adaptador simulado para demostrar clonación y TTS remotos. No ejecuta llamadas reales.',
    capabilities: { operations: ['clone','tts'], maxReferences: 1, minDurationSec: 10, maxDurationSec: 45, transcription: 'required', languages: ['es','en'], emotionalTags: ['laugh','surprise','anger','pause'], controls: ['temperature','speed','intensity'], audioFormats: ['wav','mp3'], limitations: ['Una sola referencia por clonación en este perfil simulado.'], providerVersion: 'demo-fish-compatible', dynamicSettings: [ { key:'speed', label:'Velocidad', type:'range', min:0.75, max:1.25, defaultValue:1 }, { key:'intensity', label:'Intensidad', type:'range', min:0, max:100, defaultValue:60 } ] },
    configFields: [{ key:'apiKey', label:'Clave API futura', type:'password', placeholder:'No introducir secretos reales en Fase 1', futureOnly:true }]
  },
  {
    id: 'local-a', name: 'Motor local A — demo', kind: 'both', locality: 'local', status: 'available', version: '0.8-demo',
    description: 'Motor local ficticio para demostrar capacidades múltiples y compatibilidad no automática.',
    capabilities: { operations: ['clone','tts'], maxReferences: 5, minDurationSec: 5, maxDurationSec: 120, transcription: 'optional', languages: ['es'], emotionalTags: ['pause','whisper','emphasis'], controls: ['speed','pitch','pauseLength'], audioFormats: ['wav'], limitations: ['No reutiliza referencias externas de proveedores remotos.'], providerVersion: 'local-a-demo', dynamicSettings: [ { key:'pitch', label:'Tono', type:'range', min:-12, max:12, defaultValue:0 }, { key:'denoise', label:'Limpieza de ruido', type:'toggle', defaultValue:true } ] },
    configFields: [{ key:'modelPath', label:'Ruta de modelo futura', type:'path', placeholder:'C:/Modelos/VoiceStudio', futureOnly:true }]
  },
  {
    id: 'local-b', name: 'Motor local B — demo', kind: 'tts', locality: 'local', status: 'not_configured', version: '0.3-demo',
    description: 'Motor TTS ficticio no configurado para validar estados de advertencia.',
    capabilities: { operations: ['tts'], maxReferences: 0, minDurationSec: 0, maxDurationSec: 0, transcription: 'unsupported', languages: ['es','en','pt'], emotionalTags: ['joy','sadness'], controls: ['speed'], audioFormats: ['wav','ogg'], limitations: ['No permite clonación en este perfil simulado.'], providerVersion: 'local-b-demo', dynamicSettings: [ { key:'voiceColor', label:'Color vocal', type:'select', options:['Neutro','Cálido','Brillante'], defaultValue:'Neutro' } ] },
    configFields: [{ key:'port', label:'Puerto local futuro', type:'number', placeholder:'5600', futureOnly:true }]
  }
];

export const demoReferences: AudioReference[] = [
  { id:'ref-topota-1', name:'Topota referencia original', durationSec:38, format:'wav', transcript:'Hola chat, esto es una prueba de voz.', quality:'excellent', engineHint:'fish-sim', source:'library' },
  { id:'ref-topota-2', name:'Topota nuevas muestras', durationSec:74, format:'wav', transcript:'JAJAJAJAaaaáááá, seguimos probando.', quality:'good', engineHint:'fish-sim', source:'library' },
  { id:'ref-chiquito-1', name:'Chiquito frase corta', durationSec:22, format:'mp3', quality:'warning', engineHint:'local-a', source:'library' },
  { id:'ref-dumbledore-1', name:'Dumbledore narración', durationSec:64, format:'wav', transcript:'La magia también necesita latencia baja.', quality:'good', engineHint:'fish-sim', source:'library' }
];

export const demoVoices: Voice[] = [
  { id:'voice-topota', displayName:'Topota', streamerAlias:'topota', avatar:'🦊', description:'Voz principal para recompensas rápidas y pruebas de expresividad.', enabledForStreamerBot:true, activeVersionId:'topota-v2', versions:[
    { id:'topota-v1', label:'v1', createdAt:'2025-01-04T10:00:00.000Z', engineId:'fish-sim', externalReferenceId:'demo-fish-topota-v1', notes:'Referencia original.', status:'ready', sampleReferenceIds:['ref-topota-1'] },
    { id:'topota-v2', label:'v2', createdAt:'2025-02-11T12:00:00.000Z', engineId:'fish-sim', externalReferenceId:'demo-fish-topota-v2', notes:'Nuevas muestras con risas.', status:'ready', sampleReferenceIds:['ref-topota-2'] },
    { id:'topota-v3', label:'v3', createdAt:'2025-03-02T09:30:00.000Z', engineId:'local-a', externalReferenceId:'demo-localA-topota-v3', notes:'Variante experimental local.', status:'experimental', sampleReferenceIds:['ref-topota-2'] }
  ]},
  { id:'voice-dumbledore', displayName:'Dumbledore', streamerAlias:'dumbledore', avatar:'🧙', description:'Narración grave con intención dramática.', enabledForStreamerBot:true, activeVersionId:'dumbledore-v1', versions:[{ id:'dumbledore-v1', label:'v1', createdAt:'2025-01-18T16:00:00.000Z', engineId:'fish-sim', externalReferenceId:'demo-fish-dumbledore-v1', notes:'Registro importado de proveedor externo.', status:'ready', sampleReferenceIds:['ref-dumbledore-1'] }]},
  { id:'voice-chiquito', displayName:'Chiquito', streamerAlias:'chiquito', avatar:'🎭', description:'Voz cómica deshabilitada para evitar usos accidentales.', enabledForStreamerBot:false, activeVersionId:'chiquito-v3', versions:[
    { id:'chiquito-v1', label:'v1', createdAt:'2025-01-09T11:00:00.000Z', engineId:'local-a', externalReferenceId:'demo-localA-chiquito-v1', notes:'Primera prueba local.', status:'ready', sampleReferenceIds:['ref-chiquito-1'] },
    { id:'chiquito-v3', label:'v3', createdAt:'2025-03-07T13:20:00.000Z', engineId:'local-a', externalReferenceId:'demo-localA-chiquito-v3', notes:'Variante experimental con pausas.', status:'experimental', sampleReferenceIds:['ref-chiquito-1'] }
  ]},
  { id:'voice-chocas', displayName:'Chocás', streamerAlias:'chocas', avatar:'⚡', description:'Voz energética para clips de alto ritmo.', enabledForStreamerBot:true, activeVersionId:'chocas-v1', versions:[{ id:'chocas-v1', label:'v1', createdAt:'2025-02-21T15:10:00.000Z', engineId:'local-a', externalReferenceId:'demo-localA-chocas-v1', notes:'Clonación local simulada.', status:'ready', sampleReferenceIds:['ref-topota-1'] }]}
];

export const demoProfiles: EmotionalProfile[] = [
  { id:'balanced', name:'Equilibrado para directo', mode:'literal', freedom:35, active:true, provider:'Director local simulado' },
  { id:'comic', name:'Comedia expresiva', mode:'creative', freedom:70, active:false, provider:'Proveedor externo simulado' },
  { id:'strict', name:'Literal estricto', mode:'literal', freedom:10, active:false, provider:'Reglas locales simuladas' }
];

export const demoSettings: ApplicationSettings = {
  service: { status:'active', host:'127.0.0.1', port:4317, autoStart:true, keepRunningOnClose:true },
  production: { ttsEngineId:'fish-sim', emotionalDirectorEnabled:true, emotionalProfileId:'balanced' },
  general: { storageFolder:'%APPDATA%/VoiceStudio/Demo', audioOutput:'Dispositivo predeterminado', historyRetentionDays:30, diagnosticsVerbose:false }
};

const mkEvent = (jobId:string, stage:string, summary:string, level:'info'|'warning'|'error', detail:string) => ({ id:`evt-${jobId}-${stage}`, jobId, at:nowIso(), stage, summary, technicalDetail:detail, level, simulated:true as const });
const mkErrorJob = (id:string,order:number,summary:string,stage:string,originalText:string):GenerationJob => ({ id,order,request:{id:`REQ-${id}`,origin:'Laboratorio TTS',voiceId:'voice-topota',versionId:'topota-v2',engineId:'fish-sim',originalText,emotionalMode:'literal',emotionalDirectorEnabled:true,createdAt:nowIso()},status:'error',startedAt:nowIso(),completedAt:nowIso(),error:{summary,stage,technicalDetail:`Caso de error simulado: ${summary}. Texto original conservado: ${originalText}`},snapshot:{voiceName:'Topota',versionLabel:'v2',engineName:'Fish Audio — demo',productionEngineId:'fish-sim',activeVersionIdAtStart:'topota-v2',emotionalMode:'literal',emotionalDirectorEnabled:true,engineParameters:{speed:1,intensity:60},emotionalProfileId:'balanced',compatibility:'compatible'},events:[mkEvent(id,stage,summary,'error','Evento preparado exclusivamente para validar el diagnóstico individual.')]});

export const demoJobs: GenerationJob[] = [
  { id:'JOB-1007', order:1, request:{ id:'REQ-1007', origin:'Streamer.bot demo', voiceId:'voice-topota', versionId:'topota-v2', engineId:'fish-sim', originalText:'topota: Hola Topota, te voy a contar un chiste. JAJAJAJA.', emotionalMode:'creative', emotionalDirectorEnabled:true, createdAt:nowIso() }, status:'completed', startedAt:nowIso(), completedAt:nowIso(), result:{ durationSec:5.8, processingMs:1840, demoAudioLabel:'Audio de prueba simulado' }, snapshot:{ voiceName:'Topota', versionLabel:'v2', engineName:'Fish Audio — demo', productionEngineId:'fish-sim', activeVersionIdAtStart:'topota-v2', emotionalMode:'creative', emotionalDirectorEnabled:true, engineParameters:{ speed:1, intensity:60 }, emotionalProfileId:'balanced', compatibility:'compatible' }, events:[mkEvent('JOB-1007','completed','Generación simulada completada','info','No se creó audio real. Resultado de demostración.')] },
  { id:'JOB-1008', order:2, request:{ id:'REQ-1008', origin:'Streamer.bot demo', voiceId:'voice-chiquito', versionId:'chiquito-v3', engineId:'local-a', originalText:'chiquito: ¿¿¿???---!!!', emotionalMode:'literal', emotionalDirectorEnabled:false, createdAt:nowIso() }, status:'error', startedAt:nowIso(), completedAt:nowIso(), error:{ summary:'Voz deshabilitada para solicitudes externas.', stage:'Validación de catálogo', technicalDetail:'voice.enabledForStreamerBot=false. Texto original conservado: ¿¿¿???---!!!' }, snapshot:{ voiceName:'Chiquito', versionLabel:'v3', engineName:'Motor local A — demo', productionEngineId:'fish-sim', activeVersionIdAtStart:'chiquito-v3', emotionalMode:'literal', emotionalDirectorEnabled:false, engineParameters:{ pitch:0, denoise:true }, emotionalProfileId:'balanced', compatibility:'compatible' }, events:[mkEvent('JOB-1008','validation','Voz no disponible','error','Evento simulado específico del trabajo. No hay claves ni secretos.')] },
  { id:'JOB-1009', order:3, request:{ id:'REQ-1009', origin:'Laboratorio TTS', voiceId:'voice-dumbledore', versionId:'dumbledore-v1', engineId:'local-b', originalText:'AAAAA---éééé%%%%', emotionalMode:'literal', emotionalDirectorEnabled:true, createdAt:nowIso() }, status:'error', startedAt:nowIso(), completedAt:nowIso(), error:{ summary:'Motor no configurado.', stage:'Preparación de motor', technicalDetail:'engine.status=not_configured para local-b. Texto original preservado íntegro.' }, snapshot:{ voiceName:'Dumbledore', versionLabel:'v1', engineName:'Motor local B — demo', productionEngineId:'fish-sim', activeVersionIdAtStart:'dumbledore-v1', emotionalMode:'literal', emotionalDirectorEnabled:true, engineParameters:{ voiceColor:'Neutro' }, emotionalProfileId:'balanced', compatibility:'engine_unavailable' }, events:[mkEvent('JOB-1009','engine','Motor incompatible o no configurado','error','Diagnóstico simulado para validar la UI.')] },
  mkErrorJob('JOB-1010',4,'Error de proveedor simulado.','Proveedor demo','Texto intacto ante error de proveedor: AAAAA---éééé%%%%'),
  mkErrorJob('JOB-1011',5,'Tiempo de espera agotado.','Espera demo','Texto intacto tras timeout: JAJAJAJAaaaáááá'),
  mkErrorJob('JOB-1012',6,'Texto inválido según una regla configurable.','Validación configurable','¿¿¿???---!!!')
];
