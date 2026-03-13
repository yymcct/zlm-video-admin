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
