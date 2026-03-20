<template>
  <a-card class="security-arm-card" :bordered="false">
    <div class="arm-header">
      <div class="arm-title-wrap">
        <a-icon type="safety" class="arm-title-icon" />
        <span class="arm-title">布撤防控制</span>
      </div>
      <a-spin v-if="statusLoading" size="small" />
      <a-tag v-else :color="statusColor" class="arm-status">{{ statusText }}</a-tag>
    </div>

    <div class="arm-actions">
      <a-button
        type="primary"
        icon="lock"
        :loading="arming"
        :disabled="!deviceId || arming || disarming || statusLoading || state === 'armed'"
        @click="handleArm"
      >
        布防
      </a-button>
      <a-button
        type="danger"
        icon="unlock"
        :loading="disarming"
        :disabled="!deviceId || arming || disarming || statusLoading || state === 'disarmed'"
        @click="handleDisarm"
      >
        撤防
      </a-button>
      <span v-if="lastOperation" class="arm-last-op">
        上次操作：{{ lastOperation }}
      </span>
    </div>
  </a-card>
</template>

<script>
import { armDevice, disarmDevice, getDeviceStatus } from '@/api/device';

const STATUS = {
  idle: { text: '待机', color: 'default' },
  armed: { text: '已布防', color: 'green' },
  disarmed: { text: '已撤防', color: 'orange' },
  error: { text: '操作失败', color: 'red' },
};

export default {
  name: 'SecurityArmCard',
  props: {
    deviceId: {
      type: String,
      default: '',
    },
  },
  data() {
    return {
      arming: false,
      disarming: false,
      statusLoading: false,
      state: 'idle',
      lastOperation: '',
    };
  },
  computed: {
    statusText() {
      return STATUS[this.state]?.text ?? '待机';
    },
    statusColor() {
      return STATUS[this.state]?.color ?? 'default';
    },
  },
  watch: {
    deviceId(val) {
      if (val) this.fetchStatus();
      else this.state = 'idle';
    },
  },
  mounted() {
    if (this.deviceId) this.fetchStatus();
  },
  methods: {
    async fetchStatus() {
      this.statusLoading = true;
      try {
        const res = await getDeviceStatus(this.deviceId);
        if (res?.success) {
          this.state = res.status?.is_armed ? 'armed' : 'disarmed';
        }
      } catch (e) {
        this.$message.error('获取设备状态失败：' + (e?.response?.data?.message || e.message || '请求异常'));
      } finally {
        this.statusLoading = false;
      }
    },

    async handleArm() {
      if (!this.deviceId) {
        this.$message.warning('请先输入 Device ID');
        return;
      }
      this.arming = true;
      try {
        await armDevice(this.deviceId);
        this.state = 'armed';
        this.lastOperation = `布防 ${new Date().toLocaleTimeString()}`;
        this.$message.success('布防指令已下发');
      } catch (e) {
        this.state = 'error';
        this.$message.error('布防失败：' + (e?.response?.data?.message || e.message || '请求异常'));
      } finally {
        this.arming = false;
      }
    },

    async handleDisarm() {
      if (!this.deviceId) {
        this.$message.warning('请先输入 Device ID');
        return;
      }
      this.disarming = true;
      try {
        await disarmDevice(this.deviceId);
        this.state = 'disarmed';
        this.lastOperation = `撤防 ${new Date().toLocaleTimeString()}`;
        this.$message.success('撤防指令已下发');
      } catch (e) {
        this.state = 'error';
        this.$message.error('撤防失败：' + (e?.response?.data?.message || e.message || '请求异常'));
      } finally {
        this.disarming = false;
      }
    },
  },
};
</script>

<style scoped>
.security-arm-card {
  background: #fafafa;
}

.arm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.arm-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.arm-title-icon {
  font-size: 16px;
  color: #1890ff;
}

.arm-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}

.arm-status {
  margin: 0;
  font-size: 13px;
}

.arm-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.arm-last-op {
  font-size: 12px;
  color: #8c8c8c;
}
</style>
