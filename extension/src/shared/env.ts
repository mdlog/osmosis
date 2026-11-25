/** Build-time environment, injected by scripts/build.mjs from firebase.config.json + .env.local. */
export interface OsmEnv {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
  /** App Check debug token for the extension build (never committed; from .env.local). */
  appCheckDebugToken?: string;
  /** reCAPTCHA Enterprise site key for the hosted web build (public). */
  recaptchaSiteKey?: string;
  /** `textFallback` answers when `text` reports "high demand" (cloud features only). */
  models: { text: string; textFallback?: string; tts: string };
}

declare const __OSM_ENV__: OsmEnv;
export const ENV: OsmEnv = __OSM_ENV__;
