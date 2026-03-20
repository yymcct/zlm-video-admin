import axios from 'axios';

const DEVICE_API_BASE = process.env.VUE_APP_VOICE_SERVER_URL;

const deviceAxios = axios.create({
  baseURL: DEVICE_API_BASE,
  timeout: 10000,
});

/**
 * 获取设备列表
 * GET /vigidoor/api/v1/devices
 */
export function getDeviceList() {
  return deviceAxios.get('/vigidoor/api/v1/devices').then(res => res.data);
}

/**
 * 查询设备布防状态
 * GET /vigidoor/api/v1/devices/:deviceId/status
 */
export function getDeviceStatus(deviceId) {
  return deviceAxios.get(`/vigidoor/api/v1/devices/${deviceId}/status`).then(res => res.data);
}

/**
 * 布防 - 向设备下发 arm 指令
 * POST /vigidoor/api/v1/security/arm
 */
export function armDevice(deviceId) {
  return deviceAxios.post('/vigidoor/api/v1/security/arm', { device_id: deviceId }).then(res => res.data);
}

/**
 * 撤防 - 向设备下发 disarm 指令
 * POST /vigidoor/api/v1/security/disarm
 */
export function disarmDevice(deviceId) {
  return deviceAxios.post('/vigidoor/api/v1/security/disarm', { device_id: deviceId }).then(res => res.data);
}
