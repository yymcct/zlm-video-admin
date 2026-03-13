import axios from 'axios';

const DEFAULT_VOICE_SERVER_PORT = '5002';
const DEFAULT_VOICE_SERVER_URL = 'http://192.168.1.119:5002';

function normalizeServerUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

export function getDefaultVoiceServerUrl() {
  const envVoiceServerUrl = process.env.VUE_APP_VOICE_SERVER_URL;
  if (envVoiceServerUrl) {
    return normalizeServerUrl(envVoiceServerUrl);
  }

  const host = process.env.VUE_APP_ZLMEDIAKIT_SERVICE_IP || '192.168.1.119';
  const protocol = process.env.VUE_APP_ZLMEDIAKIT_IS_SSL === 'true' ? 'https' : 'http';
  return normalizeServerUrl(`${protocol}://${host}:${DEFAULT_VOICE_SERVER_PORT}`) || DEFAULT_VOICE_SERVER_URL;
}

export function initiateVoiceCall(deviceId) {
  const serverUrl = getDefaultVoiceServerUrl();
  return axios.post(`${serverUrl}/vigidoor/api/v1/voice/call/initiate`, {
    device_id: deviceId,
  });
}

export function terminateVoiceCall(sessionId) {
  const serverUrl = getDefaultVoiceServerUrl();
  return axios.post(`${serverUrl}/vigidoor/api/v1/voice/call/terminate`, {
    session_id: sessionId,
  });
}
