<template>
  <div class="vod-wrapper">
    <div class="vod-header">
      <span class="vod-title">流媒体点播</span>
    </div>

    <!-- 设备ID 输入区 -->
    <div class="input-bar">
      <a-input
        v-model="deviceId"
        placeholder="请输入 Device ID"
        style="width: 320px"
        :disabled="playing || loading"
        @pressEnter="startPlay"
      />
      <a-button
        type="primary"
        icon="play-circle"
        :loading="loading"
        :disabled="!deviceId || playing"
        @click="startPlay"
      >
        开始播放
      </a-button>
      <a-button
        type="danger"
        icon="stop"
        :disabled="!playing && !loading"
        @click="stopPlay"
      >
        停止播放
      </a-button>
      <a-tag :color="connected ? 'green' : 'red'" class="conn-tag">
        {{ connected ? '已连接' : '未连接' }}
      </a-tag>
    </div>

    <!-- 当前播放地址 -->
    <div v-if="flvUrl" class="url-hint">
      <a-icon type="link" /> 播放地址：<span class="url-text">{{ flvUrl }}</span>
    </div>

    <!-- 视频区域 -->
    <div class="video-container">
      <video ref="videoEl" class="video-el" autoplay muted></video>
      <div v-if="statusText" class="status-overlay">{{ statusText }}</div>
    </div>

    <!-- 控制栏 -->
    <div class="controls">
      <a-button-group>
        <a-button
          :icon="isVideoPaused ? 'play-circle' : 'pause-circle'"
          :disabled="!playing"
          @click="togglePause"
        >
          {{ isVideoPaused ? '继续' : '暂停' }}
        </a-button>
        <a-button :icon="muted ? 'sound' : 'audio'" :disabled="!playing" @click="toggleMute">
          {{ muted ? '取消静音' : '静音' }}
        </a-button>
        <a-button icon="fullscreen" :disabled="!playing" @click="requestFullscreen">全屏</a-button>
        <a-button icon="reload" :disabled="!playing" :loading="loading" @click="reload">重载</a-button>
      </a-button-group>
    </div>

    <!-- 调试信息 -->
    <a-collapse class="debug-collapse" :bordered="false">
      <a-collapse-panel key="1" header="调试信息">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="已解码帧数">{{ stats.decodedFrames }}</a-descriptions-item>
          <a-descriptions-item label="已丢弃帧数">{{ stats.droppedFrames }}</a-descriptions-item>
          <a-descriptions-item label="视频总字节">{{ formatBytes(stats.totalVideoBytes) }}</a-descriptions-item>
          <a-descriptions-item label="音频总字节">{{ formatBytes(stats.totalAudioBytes) }}</a-descriptions-item>
          <a-descriptions-item label="当前速度">{{ formatBytes(stats.speed) }}/s</a-descriptions-item>
          <a-descriptions-item label="缓冲长度(s)">{{ stats.bufferLength }}</a-descriptions-item>
          <a-descriptions-item label="当前播放时间">{{ stats.currentTime }}s</a-descriptions-item>
          <a-descriptions-item label="视频编码">{{ mediaInfo.videoCodec || '-' }}</a-descriptions-item>
          <a-descriptions-item label="音频编码">{{ mediaInfo.audioCodec || '-' }}</a-descriptions-item>
          <a-descriptions-item label="分辨率">{{ mediaInfo.resolution || '-' }}</a-descriptions-item>
          <a-descriptions-item label="FPS">{{ mediaInfo.fps || '-' }}</a-descriptions-item>
          <a-descriptions-item label="重连次数">{{ retryCount }} / {{ maxRetry }}</a-descriptions-item>
        </a-descriptions>
        <div v-if="errorLogs.length" class="error-log">
          <div class="error-log-title">
            <a-icon type="warning" theme="twoTone" two-tone-color="#faad14" /> 错误日志
          </div>
          <div v-for="(log, i) in errorLogs" :key="i" class="error-log-item">{{ log }}</div>
        </div>
      </a-collapse-panel>
    </a-collapse>
  </div>
</template>

<script>
import axios from 'axios';
import flvjs from 'flv.js';

const STREAM_API_BASE = 'http://192.168.1.119:5002/api/v1/stream';
const FLV_BASE = 'http://192.168.1.119:8080/live';
const RTMP_BASE = 'rtmp://192.168.1.119:1945/live';

export default {
  name: 'VodPlayerPage',
  data() {
    return {
      deviceId: '',
      flvUrl: '',
      flvPlayer: null,
      playing: false,
      isVideoPaused: false,
      muted: true,
      connected: false,
      loading: false,
      statusText: '',
      stats: {
        decodedFrames: 0,
        droppedFrames: 0,
        totalVideoBytes: 0,
        totalAudioBytes: 0,
        speed: 0,
        bufferLength: 0,
        currentTime: 0,
      },
      mediaInfo: {
        videoCodec: '',
        audioCodec: '',
        resolution: '',
        fps: '',
      },
      errorLogs: [],
      statsTimer: null,
      retryTimer: null,
      retryCount: 0,
      maxRetry: 5,
      videoListeners: {},
    };
  },
  beforeDestroy() {
    this.destroyPlayer();
  },
  methods: {
    // ─── 推流指令 ─────────────────────────────────────────────
    async sendStartStream(deviceId) {
      try {
        await axios.post(`${STREAM_API_BASE}/start`, {
          device_id: deviceId,
          rtmp_url: `${RTMP_BASE}/${deviceId}`,
        });
      } catch (e) {
        console.warn('推流启动指令失败:', e);
        throw e;
      }
    },

    async sendStopStream(deviceId) {
      try {
        await axios.post(`${STREAM_API_BASE}/stop`, {
          device_id: deviceId,
        });
      } catch (e) {
        console.warn('推流停止指令失败:', e);
      }
    },

    // ─── 播放控制 ─────────────────────────────────────────────
    async startPlay() {
      if (!this.deviceId) {
        this.$message.warning('请输入 Device ID');
        return;
      }

      this.loading = true;
      this.statusText = '正在通知推流...';
      this.errorLogs = [];

      try {
        await this.sendStartStream(this.deviceId);
      } catch (e) {
        this.$message.error('推流启动指令发送失败，请检查推流服务是否正常');
        this.loading = false;
        this.statusText = '';
        return;
      }

      this.flvUrl = `${FLV_BASE}/${this.deviceId}.live.flv`;
      this.playing = true;
      this.retryCount = 0;

      this.$nextTick(() => this.createFlvPlayer(this.flvUrl));
    },

    async stopPlay() {
      const deviceId = this.deviceId;
      this.destroyPlayer();
      this.flvUrl = '';
      await this.sendStopStream(deviceId);
      this.$message.success('已停止播放并发送停止推流指令');
    },

    // ─── FLV 播放器 ──────────────────────────────────────────
    createFlvPlayer(url) {
      this.destroyFlvOnly();

      if (!flvjs.isSupported()) {
        this.statusText = '当前浏览器不支持 FLV 播放';
        this.loading = false;
        return;
      }

      const videoEl = this.$refs.videoEl;
      if (!videoEl) return;

      this.loading = true;
      this.statusText = '正在加载...';

      this.flvPlayer = flvjs.createPlayer(
        { type: 'flv', url, isLive: true, hasAudio: true, hasVideo: true },
        {
          enableWorker: false,
          lazyLoad: false,
          stashInitialSize: 256,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30,
        }
      );

      this.flvPlayer.attachMediaElement(videoEl);

      this.flvPlayer.on(flvjs.Events.ERROR, (errType, errDetail, errInfo) => {
        const msg = `[${new Date().toLocaleTimeString()}] 错误: ${errType} / ${errDetail}${errInfo ? ' - ' + JSON.stringify(errInfo) : ''}`;
        this.errorLogs.unshift(msg);
        if (this.errorLogs.length > 20) this.errorLogs.pop();
        this.connected = false;
        this.loading = false;
        if (this.playing) this.scheduleRetry(url);
      });

      this.flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
        const msg = `[${new Date().toLocaleTimeString()}] 服务端连接关闭，尝试重连...`;
        this.errorLogs.unshift(msg);
        this.connected = false;
        if (this.playing) this.scheduleRetry(url);
      });

      this.flvPlayer.on(flvjs.Events.RECOVERED_EARLY_EOF, () => {
        this.errorLogs.unshift(`[${new Date().toLocaleTimeString()}] 提前 EOF，已恢复`);
      });

      this.flvPlayer.on(flvjs.Events.MEDIA_INFO, () => {
        const info = this.flvPlayer.mediaInfo;
        if (info) {
          this.mediaInfo.videoCodec = info.videoCodec || '';
          this.mediaInfo.audioCodec = info.audioCodec || '';
          this.mediaInfo.resolution = info.width && info.height ? `${info.width}x${info.height}` : '';
          this.mediaInfo.fps = info.fps || '';
        }
        this.connected = true;
        this.retryCount = 0;
        this.statusText = '';
        this.loading = false;
      });

      this.flvPlayer.on(flvjs.Events.STATISTICS_INFO, (info) => {
        this.stats.decodedFrames = info.decodedFrames || 0;
        this.stats.droppedFrames = info.droppedFrames || 0;
        this.stats.totalVideoBytes = info.totalVideoBytes || 0;
        this.stats.totalAudioBytes = info.totalAudioBytes || 0;
        this.stats.speed = info.speed || 0;
        this.connected = true;
        this.statusText = '';
        this.loading = false;
      });

      this.removeVideoListeners(videoEl);
      this.videoListeners = {
        playing: () => {
          this.isVideoPaused = false;
          this.connected = true;
          this.retryCount = 0;
          this.statusText = '';
          this.loading = false;
        },
        pause: () => { this.isVideoPaused = true; },
        waiting: () => { this.statusText = '缓冲中...'; },
        canplay: () => { this.statusText = ''; },
      };
      Object.entries(this.videoListeners).forEach(([evt, fn]) => {
        videoEl.addEventListener(evt, fn);
      });

      this.flvPlayer.load();
      this.flvPlayer.play();

      if (this.statsTimer) clearInterval(this.statsTimer);
      this.statsTimer = setInterval(() => {
        if (videoEl) {
          this.stats.currentTime = videoEl.currentTime ? videoEl.currentTime.toFixed(2) : 0;
          if (videoEl.buffered && videoEl.buffered.length > 0) {
            const buf = videoEl.buffered.end(videoEl.buffered.length - 1) - videoEl.currentTime;
            this.stats.bufferLength = buf > 0 ? buf.toFixed(2) : 0;
          }
        }
      }, 500);
    },

    scheduleRetry(url) {
      if (this.retryTimer) return;
      if (this.retryCount >= this.maxRetry) {
        this.statusText = `重连失败，已达最大重试次数 (${this.maxRetry})`;
        return;
      }
      this.retryCount++;
      const delay = Math.min(2000 * this.retryCount, 10000);
      this.statusText = `连接中断，${delay / 1000}s 后进行第 ${this.retryCount}/${this.maxRetry} 次重连...`;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.playing) this.createFlvPlayer(url);
      }, delay);
    },

    // 仅销毁 flv 播放器实例，不改变 playing 状态
    destroyFlvOnly() {
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
      const videoEl = this.$refs.videoEl;
      if (videoEl) this.removeVideoListeners(videoEl);
      if (this.flvPlayer) {
        try {
          this.flvPlayer.pause();
          this.flvPlayer.unload();
          this.flvPlayer.detachMediaElement();
          this.flvPlayer.destroy();
        } catch (e) { /* ignore */ }
        this.flvPlayer = null;
      }
    },

    // 完整销毁，同时重置播放状态
    destroyPlayer() {
      this.destroyFlvOnly();
      this.playing = false;
      this.isVideoPaused = false;
      this.connected = false;
      this.statusText = '';
      this.retryCount = 0;
      this.mediaInfo = { videoCodec: '', audioCodec: '', resolution: '', fps: '' };
      this.stats = { decodedFrames: 0, droppedFrames: 0, totalVideoBytes: 0, totalAudioBytes: 0, speed: 0, bufferLength: 0, currentTime: 0 };
    },

    removeVideoListeners(videoEl) {
      Object.entries(this.videoListeners).forEach(([evt, fn]) => {
        videoEl.removeEventListener(evt, fn);
      });
      this.videoListeners = {};
    },

    togglePause() {
      const video = this.$refs.videoEl;
      if (!video) return;
      if (this.isVideoPaused) { video.play(); } else { video.pause(); }
    },

    toggleMute() {
      const video = this.$refs.videoEl;
      if (!video) return;
      video.muted = !video.muted;
      this.muted = video.muted;
    },

    requestFullscreen() {
      const video = this.$refs.videoEl;
      if (!video) return;
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
      else if (video.mozRequestFullScreen) video.mozRequestFullScreen();
    },

    reload() {
      if (this.flvUrl) this.createFlvPlayer(this.flvUrl);
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
  },
};
</script>

<style scoped>
.vod-wrapper {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 960px;
  margin: 0 auto;
}

.vod-header {
  margin-bottom: 4px;
}

.vod-title {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
}

.input-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.conn-tag {
  margin: 0;
  font-size: 13px;
}

.url-hint {
  font-size: 13px;
  color: #595959;
  word-break: break-all;
}

.url-text {
  color: #1890ff;
  font-family: monospace;
}

.video-container {
  position: relative;
  background: #000;
  border-radius: 6px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
}

.video-el {
  width: 100%;
  height: 100%;
  display: block;
}

.status-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: none;
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.debug-collapse {
  background: #fafafa;
}

.error-log {
  margin-top: 10px;
}

.error-log-title {
  font-weight: bold;
  margin-bottom: 6px;
  color: #faad14;
}

.error-log-item {
  font-size: 12px;
  color: #cf1322;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
}
</style>
