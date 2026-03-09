<template>
  <a-card class="remote-talk-card" :bordered="false">
    <div class="talk-header">
      <div class="talk-title-wrap">
        <a-icon type="customer-service" class="talk-title-icon" />
        <span class="talk-title">远程喊话</span>
      </div>
      <a-tag :color="statusColor" class="talk-status">{{ statusText }}</a-tag>
    </div>

    <div class="talk-form-row">
      <div class="talk-form-item">
        <span class="talk-label">中继地址</span>
        <a-input
          v-model="serverUrl"
          :disabled="isBusy"
          placeholder="例如: http://192.168.1.119:5002"
          @pressEnter="startCall"
        />
      </div>
    </div>

    <div class="talk-actions">
      <a-button
        type="primary"
        icon="phone"
        :loading="calling"
        :disabled="isBusy || !deviceId || !serverUrl"
        @click="startCall"
      >
        发起喊话
      </a-button>
      <a-button
        type="danger"
        icon="disconnect"
        :disabled="!isInCall"
        @click="endCall"
      >
        挂断
      </a-button>
      <a-button
        icon="sound"
        :disabled="!isInCall"
        :type="muted ? 'default' : 'primary'"
        @click="toggleMute"
      >
        {{ muted ? '已静音' : '麦克风开启' }}
      </a-button>
      <span class="talk-duration">通话时长: {{ callDurationText }}</span>
    </div>

    <div class="talk-stats">
      <div class="talk-stat-item">
        <div class="talk-stat-value">{{ sentCount }}</div>
        <div class="talk-stat-label">已发送音频包</div>
      </div>
      <div class="talk-stat-item">
        <div class="talk-stat-value">{{ recvCount }}</div>
        <div class="talk-stat-label">已接收消息</div>
      </div>
      <div class="talk-stat-item">
        <div class="talk-stat-value">{{ droppedCount }}</div>
        <div class="talk-stat-label">丢弃音频包</div>
      </div>
    </div>

    <a-collapse :bordered="false" class="talk-log-collapse">
      <a-collapse-panel key="1" header="会话日志">
        <div class="talk-log-list">
          <div v-for="(item, index) in logs" :key="index" class="talk-log-item">
            {{ item }}
          </div>
          <div v-if="!logs.length" class="talk-log-empty">暂无日志</div>
        </div>
      </a-collapse-panel>
    </a-collapse>
  </a-card>
</template>

<script>
import { io } from 'socket.io-client';
import { getDefaultVoiceServerUrl, initiateVoiceCall, terminateVoiceCall } from '@/api/voice';

const STATUS = {
  idle: '未连接',
  calling: '呼叫中',
  waiting: '等待设备',
  connected: '通话中',
  error: '异常',
};

export default {
  name: 'RemoteTalkCard',
  props: {
    deviceId: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      serverUrl: getDefaultVoiceServerUrl(),
      socket: null,
      mediaStream: null,
      mediaRecorder: null,
      sessionId: '',
      status: 'idle',
      calling: false,
      inCall: false,
      muted: false,
      sentCount: 0,
      recvCount: 0,
      droppedCount: 0,
      logs: [],
      callStartTs: 0,
      callDurationSeconds: 0,
      durationTimer: null,
      recorderMimeType: '',
    };
  },
  computed: {
    isBusy() {
      return this.calling || this.inCall;
    },
    isInCall() {
      return this.inCall;
    },
    statusText() {
      return STATUS[this.status] || STATUS.idle;
    },
    statusColor() {
      if (this.status === 'connected') return 'green';
      if (this.status === 'calling' || this.status === 'waiting') return 'blue';
      if (this.status === 'error') return 'red';
      return 'default';
    },
    callDurationText() {
      const total = this.callDurationSeconds;
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    },
  },
  beforeDestroy() {
    this.endCall({ silent: true });
  },
  methods: {
    addLog(message) {
      const time = new Date().toLocaleTimeString();
      this.logs.unshift(`[${time}] ${message}`);
      if (this.logs.length > 80) {
        this.logs.pop();
      }
    },
    normalizeServerUrl(url) {
      let normalized = (url || '').trim();
      if (!normalized) {
        return '';
      }
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `http://${normalized}`;
      }
      return normalized.replace(/\/$/, '');
    },
    async startCall() {
      if (this.isBusy) {
        return;
      }
      if (!this.deviceId) {
        this.$message.warning('请先选择设备 ID');
        return;
      }
      const serverUrl = this.normalizeServerUrl(this.serverUrl);
      if (!serverUrl) {
        this.$message.warning('请先填写中继地址');
        return;
      }

      this.serverUrl = serverUrl;
      this.calling = true;
      this.status = 'calling';
      this.sentCount = 0;
      this.recvCount = 0;
      this.droppedCount = 0;
      this.callDurationSeconds = 0;
      this.callStartTs = 0;
      this.logs = [];

      try {
        this.addLog('正在发起喊话请求...');
        const { data } = await initiateVoiceCall(serverUrl, this.deviceId);
        if (!data || !data.success || !data.session_id) {
          throw new Error((data && data.error) || '服务端返回异常');
        }

        this.sessionId = data.session_id;
        this.addLog(`呼叫请求成功，会话ID: ${this.sessionId}`);
        this.addLog(`设备通知状态: ${data.device_notified ? '已通知' : '未通知'}`);

        await this.connectSocket(serverUrl);
      } catch (error) {
        this.status = 'error';
        this.addLog(`发起喊话失败: ${error.message || error}`);
        this.$message.error(`发起喊话失败: ${error.message || '未知错误'}`);
        this.cleanup(false);
      } finally {
        this.calling = false;
      }
    },
    async connectSocket(serverUrl) {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      this.addLog('正在连接语音 WebSocket...');

      return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
          transports: ['websocket'],
          reconnectionAttempts: 3,
          timeout: 8000,
        });

        let settled = false;
        const finishResolve = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const finishReject = (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        socket.on('connect', async () => {
          this.socket = socket;
          this.status = 'waiting';
          this.addLog('WebSocket 已连接，准备加入会话');

          socket.emit('browser_join', {
            device_id: this.deviceId,
            session_id: this.sessionId,
          });

          finishResolve();
        });

        socket.on('connect_error', (err) => {
          this.addLog(`WebSocket 连接失败: ${err.message || err}`);
          finishReject(new Error('WebSocket 连接失败'));
        });

        socket.on('server_ready', (data) => {
          this.addLog(`服务端就绪: ${(data && data.message) || 'ok'}`);
        });

        socket.on('joined', (data) => {
          this.addLog(`已加入会话，角色: ${(data && data.role) || 'browser'}`);
          if (data && data.waiting_for_device) {
            this.status = 'waiting';
            this.addLog('等待设备端连接...');
          }
        });

        socket.on('call_established', async () => {
          this.addLog('通话已建立，开始采集麦克风音频');
          this.status = 'connected';
          this.inCall = true;
          this.callStartTs = Date.now();
          this.startDurationTimer();
          try {
            await this.startMicStreaming();
          } catch (err) {
            this.addLog(`麦克风启动失败: ${err.message || err}`);
            this.$message.error('无法访问麦克风，请检查浏览器权限');
            this.endCall();
          }
        });

        socket.on('audio_data', () => {
          this.recvCount += 1;
        });

        socket.on('peer_hangup', () => {
          this.addLog('对端已挂断');
          this.endCall({ silent: true });
        });

        socket.on('peer_disconnected', () => {
          this.addLog('对端已断开连接');
          this.status = 'waiting';
        });

        socket.on('call_terminated', (data) => {
          this.addLog(`通话终止: ${(data && data.message) || '未知原因'}`);
          this.endCall({ silent: true });
        });

        socket.on('error', (data) => {
          const msg = (data && data.message) || '未知错误';
          this.addLog(`会话错误: ${msg}`);
          this.status = 'error';
        });

        socket.on('disconnect', () => {
          this.addLog('WebSocket 已断开');
          if (this.inCall || this.calling) {
            this.endCall({ silent: true });
          }
        });
      });
    },
    async startMicStreaming() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前浏览器不支持麦克风采集');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.mediaStream = stream;
      this.muted = false;

      const mimeType = this.pickRecorderMimeType();
      this.recorderMimeType = mimeType;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 24000 });

      recorder.ondataavailable = async (event) => {
        if (!event.data || !event.data.size) {
          return;
        }
        if (!this.socket || !this.socket.connected || !this.inCall) {
          this.droppedCount += 1;
          return;
        }

        try {
          const base64Audio = await this.blobToBase64(event.data);
          this.socket.emit('audio_data', {
            audio: base64Audio,
            mime_type: this.recorderMimeType || event.data.type || 'audio/webm',
            timestamp: Date.now(),
            session_id: this.sessionId,
            device_id: this.deviceId,
            source: 'browser',
          });
          this.sentCount += 1;
        } catch (err) {
          this.droppedCount += 1;
          this.addLog(`音频编码失败: ${err.message || err}`);
        }
      };

      recorder.onerror = (event) => {
        const reason = event && event.error ? event.error.message : '未知错误';
        this.addLog(`录音器错误: ${reason}`);
      };

      recorder.start(250);
      this.mediaRecorder = recorder;
      this.addLog(`麦克风采集已开启，编码格式: ${this.recorderMimeType || '浏览器默认'}`);
    },
    pickRecorderMimeType() {
      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ];
      if (typeof MediaRecorder === 'undefined') {
        return '';
      }
      for (let i = 0; i < mimeCandidates.length; i += 1) {
        const type = mimeCandidates[i];
        if (MediaRecorder.isTypeSupported(type)) {
          return type;
        }
      }
      return '';
    },
    blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result || '';
          const chunks = String(result).split(',');
          if (chunks.length < 2) {
            reject(new Error('无效音频数据'));
            return;
          }
          resolve(chunks[1]);
        };
        reader.onerror = () => reject(new Error('读取音频失败'));
        reader.readAsDataURL(blob);
      });
    },
    toggleMute() {
      if (!this.mediaStream) {
        return;
      }
      const enabled = this.muted;
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      this.muted = !enabled;
      this.addLog(this.muted ? '麦克风已静音' : '麦克风已取消静音');
    },
    startDurationTimer() {
      this.stopDurationTimer();
      this.durationTimer = setInterval(() => {
        if (!this.callStartTs) {
          this.callDurationSeconds = 0;
          return;
        }
        this.callDurationSeconds = Math.floor((Date.now() - this.callStartTs) / 1000);
      }, 1000);
    },
    stopDurationTimer() {
      if (this.durationTimer) {
        clearInterval(this.durationTimer);
        this.durationTimer = null;
      }
    },
    stopMediaRecorder() {
      if (this.mediaRecorder) {
        try {
          if (this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
          }
        } catch (error) {
          // Ignore recorder stop errors from browser edge cases.
        }
        this.mediaRecorder = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
    },
    cleanup(resetLogs = false) {
      this.stopDurationTimer();
      this.stopMediaRecorder();

      if (this.socket) {
        try {
          this.socket.off();
          this.socket.disconnect();
        } catch (error) {
          // Ignore socket clean-up errors.
        }
        this.socket = null;
      }

      this.sessionId = '';
      this.inCall = false;
      this.calling = false;
      this.muted = false;
      this.callStartTs = 0;
      this.callDurationSeconds = 0;
      this.status = 'idle';

      if (resetLogs) {
        this.logs = [];
      }
    },
    async endCall(options = {}) {
      const { silent = false } = options;
      const socket = this.socket;
      const sessionId = this.sessionId;
      const serverUrl = this.normalizeServerUrl(this.serverUrl);

      this.stopDurationTimer();
      this.stopMediaRecorder();

      if (sessionId && serverUrl) {
        try {
          this.addLog('正在请求服务端终止会话...');
          const { data } = await terminateVoiceCall(serverUrl, sessionId);
          if (data && data.success === false) {
            throw new Error(data.error || '服务端终止失败');
          }
          this.addLog('服务端终止会话请求成功');
        } catch (error) {
          this.addLog(`服务端终止会话请求失败: ${error.message || error}`);
        }
      }

      if (socket && socket.connected) {
        try {
          socket.emit('hangup', {
            session_id: sessionId,
            device_id: this.deviceId,
          });
        } catch (error) {
          // Ignore hangup emit failures.
        }
      }

      this.cleanup(false);
      if (!silent) {
        this.$message.success('喊话已结束');
      }
      this.addLog('会话已结束');
    },
  },
};
</script>

<style scoped>
.remote-talk-card {
  margin-top: 8px;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.talk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.talk-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.talk-title-icon {
  color: #13a8a8;
  font-size: 16px;
}

.talk-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.talk-status {
  margin-right: 0;
}

.talk-form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.talk-form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.talk-label {
  font-size: 12px;
  color: #595959;
}

.talk-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.talk-duration {
  color: #595959;
  font-size: 12px;
}

.talk-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.talk-stat-item {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 10px;
  text-align: center;
  background: #fafafa;
}

.talk-stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #262626;
}

.talk-stat-label {
  margin-top: 2px;
  font-size: 12px;
  color: #8c8c8c;
}

.talk-log-collapse {
  background: #fafafa;
  border-radius: 6px;
}

.talk-log-list {
  max-height: 180px;
  overflow: auto;
  background: #111;
  border-radius: 6px;
  padding: 8px;
}

.talk-log-item {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  color: #d9f7be;
  line-height: 1.5;
  word-break: break-all;
}

.talk-log-empty {
  font-size: 12px;
  color: #8c8c8c;
}

@media (max-width: 900px) {
  .talk-form-row {
    grid-template-columns: 1fr;
  }

  .talk-stats {
    grid-template-columns: 1fr;
  }
}
</style>
