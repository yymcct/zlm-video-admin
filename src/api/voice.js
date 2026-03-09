import axios from 'axios';

const DEFAULT_VOICE_SERVER_PORT = '5002';

export function getDefaultVoiceServerUrl() {
  const host = process.env.VUE_APP_ZLMEDIAKIT_SERVICE_IP || '127.0.0.1';
  const protocol = process.env.VUE_APP_ZLMEDIAKIT_IS_SSL === 'true' ? 'https' : 'http';
  return `${protocol}://${host}:${DEFAULT_VOICE_SERVER_PORT}`;
}

export function initiateVoiceCall(serverUrl, deviceId) {
  return axios.post(`${serverUrl}/api/v1/voice/call/initiate`, {
    device_id: deviceId,
  });
}

export function terminateVoiceCall(serverUrl, sessionId) {
  return axios.post(`${serverUrl}/api/v1/voice/call/terminate`, {
    session_id: sessionId,
  });
}
