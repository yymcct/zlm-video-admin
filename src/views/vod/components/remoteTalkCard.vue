<template>
  <a-card class="remote-talk-card" :bordered="false">
    <div class="talk-header">
      <div class="talk-title-wrap">
        <a-icon type="customer-service" class="talk-title-icon" />
        <span class="talk-title">远程喊话</span>
      </div>
      <a-tag :color="statusColor" class="talk-status">{{ statusText }}</a-tag>
    </div>

    <div class="talk-actions">
      <a-button
        type="primary"
        icon="phone"
        :loading="calling"
        :disabled="isBusy || !deviceId"
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

  </a-card>
</template>

<script>
import { io } from 'socket.io-client';
import { initiateVoiceCall, terminateVoiceCall } from '@/api/voice';

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
      socket: null,
      mediaStream: null,
      audioContext: null,
      audioWorkletNode: null,
      audioEncoder: null,
      sessionId: '',
      status: 'idle',
      calling: false,
      inCall: false,
      muted: false,
      sentCount: 0,
      recvCount: 0,
      droppedCount: 0,
      callStartTs: 0,
      callDurationSeconds: 0,
      durationTimer: null,
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
    async startCall() {
      if (this.isBusy) {
        return;
      }
      if (!this.deviceId) {
        this.$message.warning('请先选择设备 ID');
        return;
      }
      this.calling = true;
      this.status = 'calling';
      this.sentCount = 0;
      this.recvCount = 0;
      this.droppedCount = 0;
      this.callDurationSeconds = 0;
      this.callStartTs = 0;

      try {
        console.log('正在发起喊话请求...');
        const { data } = await initiateVoiceCall(this.deviceId);
        if (!data || !data.success || !data.session_id) {
          throw new Error((data && data.error) || '服务端返回异常');
        }

        this.sessionId = data.session_id;
        console.log(`呼叫请求成功，会话ID: ${this.sessionId}`);
        console.log(`设备通知状态: ${data.device_notified ? '已通知' : '未通知'}`);

        await this.connectSocket(data.websocket_url);
      } catch (error) {
        this.status = 'error';
        console.log(`发起喊话失败: ${error.message || error}`);
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

      console.log('正在连接语音 WebSocket...');

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
          console.log('WebSocket 已连接，准备加入会话');

          socket.emit('browser_join', {
            device_id: this.deviceId,
            session_id: this.sessionId,
          });

          finishResolve();
        });

        socket.on('connect_error', (err) => {
          console.log(`WebSocket 连接失败: ${err.message || err}`);
          finishReject(new Error('WebSocket 连接失败'));
        });

        socket.on('server_ready', (data) => {
          console.log(`服务端就绪: ${(data && data.message) || 'ok'}`);
        });

        socket.on('joined', (data) => {
          console.log(`已加入会话，角色: ${(data && data.role) || 'browser'}`);
          if (data && data.waiting_for_device) {
            this.status = 'waiting';
            console.log('等待设备端连接...');
          }
        });

        socket.on('call_established', async () => {
          console.log('通话已建立，开始采集麦克风音频');
          this.status = 'connected';
          this.inCall = true;
          this.callStartTs = Date.now();
          this.startDurationTimer();
          try {
            await this.startMicStreaming();
          } catch (err) {
            console.log(`麦克风启动失败: ${err.message || err}`);
            this.$message.error('无法访问麦克风，请检查浏览器权限');
            this.endCall();
          }
        });

        socket.on('audio_data', () => {
          this.recvCount += 1;
        });

        socket.on('peer_hangup', () => {
          console.log('对端已挂断');
          this.endCall({ silent: true });
        });

        socket.on('peer_disconnected', () => {
          console.log('对端已断开连接');
          this.status = 'waiting';
        });

        socket.on('call_terminated', (data) => {
          console.log(`通话终止: ${(data && data.message) || '未知原因'}`);
          this.endCall({ silent: true });
        });

        socket.on('error', (data) => {
          const msg = (data && data.message) || '未知错误';
          console.log(`会话错误: ${msg}`);
          this.status = 'error';
        });

        socket.on('disconnect', () => {
          console.log('WebSocket 已断开');
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
      if (typeof window.AudioEncoder === 'undefined') {
        throw new Error('当前浏览器不支持 WebCodecs AudioEncoder，请使用 Chrome 94+ / Edge 94+ / Firefox 130+ 或更新版本');
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

      // AudioContext 固定 16kHz，浏览器自动将麦克风采样率重采样至 16kHz
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      this.audioContext = audioCtx;

      // WebCodecs AudioEncoder：输出裸 Opus 包（RFC 6716，无容器），每包 20ms
      const audioEncoder = new window.AudioEncoder({
        output: (chunk) => {
          if (!this.socket || !this.socket.connected || !this.inCall) {
            this.droppedCount += 1;
            return;
          }
          const buf = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(buf);
          // 直接发裸二进制，不包 JSON 对象
          // python-socketio 收到的是纯 bytes，可直接 opuslib.Decoder.decode(data, 320)
          this.socket.emit('audio_data', buf);
          this.sentCount += 1;
        },
        error: (err) => {
          console.log(`Opus 编码器错误: ${err.message || err}`);
        },
      });
      audioEncoder.configure({
        codec: 'opus',
        sampleRate: 16000,
        numberOfChannels: 1,
        bitrate: 24000,
        frameDuration: 20000, // 20ms，单位为微秒
      });
      this.audioEncoder = audioEncoder;

      // AudioWorklet：从 Web Audio 图中逐块（128 样本）抓取 Float32 PCM
      const workletCode = `
        class PcmCaptureProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (ch && ch.length) {
              // slice() 复制一份，避免浏览器复用内部缓冲区
              const copy = ch.slice();
              this.port.postMessage(copy.buffer, [copy.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
      this.audioWorkletNode = workletNode;

      // 累计样本数，用于生成连续递增的微秒时间戳
      let sampleCount = 0;
      workletNode.port.onmessage = (event) => {
        const samples = new Float32Array(event.data);
        const timestampUs = Math.round(sampleCount / 16000 * 1e6);
        sampleCount += samples.length;
        const audioData = new window.AudioData({
          format: 'f32',
          sampleRate: 16000,
          numberOfFrames: samples.length,
          numberOfChannels: 1,
          timestamp: timestampUs,
          data: samples,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      };

      source.connect(workletNode);
      // 接入 destination，防止 Chrome 因无输出节点而挂起 AudioContext
      workletNode.connect(audioCtx.destination);
      console.log('麦克风采集已开启，采样率: 16000Hz，单声道，帧长: 20ms，编码: Opus（WebCodecs）');
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
      console.log(this.muted ? '麦克风已静音' : '麦克风已取消静音');
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
      if (this.audioWorkletNode) {
        try {
          this.audioWorkletNode.port.onmessage = null;
          this.audioWorkletNode.disconnect();
        } catch (error) {
          // Ignore worklet disconnect errors.
        }
        this.audioWorkletNode = null;
      }
      if (this.audioEncoder) {
        try {
          if (this.audioEncoder.state !== 'closed') {
            this.audioEncoder.close();
          }
        } catch (error) {
          // Ignore encoder close errors.
        }
        this.audioEncoder = null;
      }
      if (this.audioContext) {
        try {
          this.audioContext.close();
        } catch (error) {
          // Ignore audio context close errors.
        }
        this.audioContext = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
    },
    cleanup() {
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

    },
    async endCall(options = {}) {
      const { silent = false } = options;
      const socket = this.socket;
      const sessionId = this.sessionId;

      this.stopDurationTimer();
      this.stopMediaRecorder();

      if (sessionId) {
        try {
          console.log('正在请求服务端终止会话...');
          const { data } = await terminateVoiceCall(sessionId);
          if (data && data.success === false) {
            throw new Error(data.error || '服务端终止失败');
          }
          console.log('服务端终止会话请求成功');
        } catch (error) {
          console.log(`服务端终止会话请求失败: ${error.message || error}`);
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
      console.log('会话已结束');
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

@media (max-width: 900px) {
  .talk-stats {
    grid-template-columns: 1fr;
  }
}
</style>

<!-- 发送到服务端的 audio_data 数据包格式：
  socket.emit('audio_data', ArrayBuffer)
  ── 裸二进制，无任何 JSON 包装 ──

  内容：裸 Opus 帧（RFC 6716），16kHz 单声道，24kbps，每包 20ms（320 样本）
  无容器封装，可直接传入 opuslib.Decoder.decode() 解码为 PCM

  Python 中继端接收：
    @sio.on('audio_data')
    async def on_audio_data(sid, data):
        # data 就是 bytes，无需解包任何对象
        opus_packet = data
        # 转发给树莓派 ...

  树莓派解码示例（Python）：
    import opuslib
    dec = opuslib.Decoder(16000, 1)
    pcm_bytes = dec.decode(opus_packet, 320)  # 320 = 20ms * 16kHz

  编码链路：
    getUserMedia → AudioContext(16kHz) → AudioWorklet(PCM Float32 128样本/块)
    → WebCodecs AudioEncoder(codec:'opus', frameDuration:20000μs) → 裸 Opus 帧
    → socket.emit('audio_data', ArrayBuffer)
-->
