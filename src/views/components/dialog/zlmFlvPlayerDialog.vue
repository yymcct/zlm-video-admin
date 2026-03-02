<template>
  <a-modal
    v-model="localShowModal"
    title="HTTP-FLV 播放器"
    :width="800"
    :footer="null"
    :destroy-on-close="true"
    @cancel="handleCancel"
  >
    <div class="player-wrapper">
      <!-- 流地址选择 -->
      <div class="url-bar">
        <a-select v-model="selectedUrl" class="url-select" @change="switchUrl">
          <a-select-option v-for="(url, idx) in flvUrls" :key="idx" :value="url">
            {{ url }}
          </a-select-option>
        </a-select>
      </div>

      <!-- 视频区域 -->
      <div class="video-container">
        <video ref="videoEl" class="video-el" autoplay muted></video>
        <div v-if="statusText" class="status-overlay">{{ statusText }}</div>
      </div>

      <!-- 控制栏 -->
      <div class="controls">
        <a-button-group>
          <a-button :icon="playing ? 'pause-circle' : 'play-circle'" @click="togglePlay">
            {{ playing ? '暂停' : '播放' }}
          </a-button>
          <a-button :icon="muted ? 'sound' : 'audio'" @click="toggleMute">
            {{ muted ? '取消静音' : '静音' }}
          </a-button>
          <a-button icon="fullscreen" @click="requestFullscreen">全屏</a-button>
          <a-button icon="reload" @click="reload" :loading="loading">重载</a-button>
        </a-button-group>

        <a-tag :color="connected ? 'green' : 'red'" class="conn-tag">
          {{ connected ? '已连接' : '未连接' }}
        </a-tag>
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
            <a-descriptions-item label="总时长(s)">{{ stats.duration }}</a-descriptions-item>
            <a-descriptions-item label="缓冲长度(s)">{{ stats.bufferLength }}</a-descriptions-item>
            <a-descriptions-item label="当前播放时间">{{ stats.currentTime }}s</a-descriptions-item>
            <a-descriptions-item label="视频编码">{{ mediaInfo.videoCodec || '-' }}</a-descriptions-item>
            <a-descriptions-item label="音频编码">{{ mediaInfo.audioCodec || '-' }}</a-descriptions-item>
            <a-descriptions-item label="分辨率">{{ mediaInfo.resolution || '-' }}</a-descriptions-item>
            <a-descriptions-item label="FPS">{{ mediaInfo.fps || '-' }}</a-descriptions-item>
          </a-descriptions>
          <!-- 错误日志 -->
          <div v-if="errorLogs.length" class="error-log">
            <div class="error-log-title"><a-icon type="warning" theme="twoTone" two-tone-color="#faad14"/> 错误日志</div>
            <div v-for="(log, i) in errorLogs" :key="i" class="error-log-item">{{ log }}</div>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </div>
  </a-modal>
</template>

<script>
import flvjs from 'flv.js';

export default {
  name: 'ZlmFlvPlayerDialog',
  props: {
    showModal: {
      type: Boolean,
      required: true,
    },
    record: {
      type: Object,
      default: () => ({}),
    },
  },
  data() {
    return {
      flvPlayer: null,
      selectedUrl: '',
      flvUrls: [],
      playing: false,
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
        duration: 0,
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
    };
  },
  computed: {
    localShowModal: {
      get() {
        return this.showModal;
      },
      set(value) {
        this.$emit('update:showModal', value);
      },
    },
  },
  watch: {
    showModal(val) {
      if (val) {
        this.$nextTick(() => this.initPlayer());
      } else {
        this.destroyPlayer();
      }
    },
    record(val) {
      if (val && this.showModal) {
        this.$nextTick(() => this.initPlayer());
      }
    },
  },
  beforeDestroy() {
    this.destroyPlayer();
  },
  methods: {
    initPlayer() {
      this.destroyPlayer();
      this.errorLogs = [];
      this.connected = false;
      this.playing = false;
      this.statusText = '正在连接...';

      // 从 record.generateOriginUrl 中筛选出 HTTP-FLV URL
      const allUrls = Array.isArray(this.record.generateOriginUrl) ? this.record.generateOriginUrl : [];
      this.flvUrls = allUrls.filter(u => /\.live\.flv/.test(u) && /^http/.test(u));

      if (!this.flvUrls.length) {
        this.statusText = '未找到可用的 HTTP-FLV 地址';
        return;
      }

      if (!this.selectedUrl || !this.flvUrls.includes(this.selectedUrl)) {
        this.selectedUrl = this.flvUrls[0];
      }

      this.createFlvPlayer(this.selectedUrl);
    },

    createFlvPlayer(url) {
      if (!flvjs.isSupported()) {
        this.statusText = '当前浏览器不支持 FLV 播放';
        return;
      }

      this.loading = true;
      this.statusText = '正在加载...';

      const videoEl = this.$refs.videoEl;
      if (!videoEl) return;

      this.flvPlayer = flvjs.createPlayer(
        { type: 'flv', url, isLive: true, hasAudio: true, hasVideo: true },
        {
          enableWorker: false,
          lazyLoadMaxDuration: 3 * 60,
          seekType: 'range',
          stashInitialSize: 128,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 10,
          autoCleanupMinBackwardDuration: 5,
        }
      );

      this.flvPlayer.attachMediaElement(videoEl);

      this.flvPlayer.on(flvjs.Events.ERROR, (errType, errDetail, errInfo) => {
        const msg = `[${new Date().toLocaleTimeString()}] 错误: ${errType} / ${errDetail}${errInfo ? ' - ' + JSON.stringify(errInfo) : ''}`;
        this.errorLogs.unshift(msg);
        if (this.errorLogs.length > 20) this.errorLogs.pop();
        this.connected = false;
        this.statusText = '播放错误: ' + errType;
        this.loading = false;
      });

      this.flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
        this.connected = false;
        this.statusText = '加载完成';
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

      videoEl.addEventListener('playing', () => {
        this.playing = true;
        this.connected = true;
        this.statusText = '';
        this.loading = false;
      });
      videoEl.addEventListener('pause', () => { this.playing = false; });
      videoEl.addEventListener('waiting', () => { this.statusText = '缓冲中...'; });
      videoEl.addEventListener('canplay', () => { this.statusText = ''; });

      this.flvPlayer.load();
      this.flvPlayer.play();

      // 轮询 video 元素状态更新时间/缓冲
      this.statsTimer = setInterval(() => {
        if (videoEl) {
          this.stats.currentTime = videoEl.currentTime ? videoEl.currentTime.toFixed(2) : 0;
          this.stats.duration = isFinite(videoEl.duration) ? videoEl.duration.toFixed(2) : 0;
          if (videoEl.buffered && videoEl.buffered.length > 0) {
            const buf = videoEl.buffered.end(videoEl.buffered.length - 1) - videoEl.currentTime;
            this.stats.bufferLength = buf > 0 ? buf.toFixed(2) : 0;
          }
        }
      }, 500);
    },

    destroyPlayer() {
      if (this.statsTimer) {
        clearInterval(this.statsTimer);
        this.statsTimer = null;
      }
      if (this.flvPlayer) {
        try {
          this.flvPlayer.pause();
          this.flvPlayer.unload();
          this.flvPlayer.detachMediaElement();
          this.flvPlayer.destroy();
        } catch (e) { /* ignore */ }
        this.flvPlayer = null;
      }
      this.playing = false;
      this.connected = false;
      this.statusText = '';
    },

    switchUrl(url) {
      this.selectedUrl = url;
      this.createFlvPlayer(url);
    },

    togglePlay() {
      const video = this.$refs.videoEl;
      if (!video) return;
      if (this.playing) {
        video.pause();
      } else {
        video.play();
      }
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
      this.createFlvPlayer(this.selectedUrl);
    },

    handleCancel() {
      this.destroyPlayer();
      this.$emit('update:showModal', false);
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
.player-wrapper {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.url-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.url-select {
  flex: 1;
  width: 100%;
}

.video-container {
  position: relative;
  background: #000;
  border-radius: 4px;
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

.conn-tag {
  margin: 0;
  font-size: 13px;
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
