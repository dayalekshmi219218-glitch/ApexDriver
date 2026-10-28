import type { Api } from './apiTypes';
import { httpApi, API_URL } from './httpApi';
import { mockApi } from './mockApi';

export type { Api } from './apiTypes';
export { UPLOAD_STEPS, MAX_UPLOAD_BYTES, sniffFile } from './apiTypes';

/** True when VITE_API_URL points at the backend; otherwise the in-browser simulator is used. */
export const isLive = Boolean(API_URL);
export const api: Api = isLive ? httpApi : mockApi;
