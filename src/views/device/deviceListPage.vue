<template>
  <div class="custom-div">
    <div class="operate-div">
      <a-button type="primary" icon="reload" @click="fetchDeviceList">刷新</a-button>
    </div>
    <a-table
      :columns="columns"
      :data-source="deviceList"
      :loading="loading"
      :pagination="{ pageSize: 20 }"
      row-key="device_id"
    >
      <div slot="status" slot-scope="status">
        <a-badge v-if="status === 'ONLINE'" status="success" text="在线" />
        <a-badge v-else status="error" text="离线" />
      </div>
      <div slot="action" slot-scope="text, record">
        <a-button
          v-if="record.status === 'ONLINE'"
          type="primary"
          size="small"
          icon="play-circle"
          @click="playDevice(record)"
        >
          管理
        </a-button>
        <span v-else style="color: #ccc;">-</span>
      </div>
    </a-table>
  </div>
</template>

<script>
import { getDeviceList } from '@/api/device';

export default {
  name: 'DeviceListPage',
  data() {
    return {
      loading: false,
      deviceList: [],
      columns: [
        { title: '设备名称', dataIndex: 'device_name', key: 'device_name', customRender: v => v || '-' },
        { title: '设备ID', dataIndex: 'device_id', key: 'device_id' },
        { title: '产品名称', dataIndex: 'product_name', key: 'product_name', customRender: v => v || '-' },
        { title: '节点类型', dataIndex: 'node_type', key: 'node_type', customRender: v => v || '-' },
        { title: '应用名称', dataIndex: 'app_name', key: 'app_name', customRender: v => v || '-' },
        { title: '描述', dataIndex: 'description', key: 'description', customRender: v => v || '-' },
        { title: '固件版本', dataIndex: 'fw_version', key: 'fw_version', customRender: v => v || '-' },
        { title: '软件版本', dataIndex: 'sw_version', key: 'sw_version', customRender: v => v || '-' },
        {
          title: '在线状态',
          dataIndex: 'status',
          key: 'status',
          scopedSlots: { customRender: 'status' },
        },
        {
          title: '操作',
          key: 'action',
          scopedSlots: { customRender: 'action' },
        },
      ],
    };
  },
  mounted() {
    this.fetchDeviceList();
  },
  methods: {
    async fetchDeviceList() {
      this.loading = true;
      try {
        const data = await getDeviceList();
        this.deviceList = (data && data.devices) ? data.devices : [];
      } catch (e) {
        this.$message.error('获取设备列表失败：' + (e.message || e));
      } finally {
        this.loading = false;
      }
    },
    playDevice(record) {
      this.$router.push({ path: '/vod', query: { device_id: record.device_id } });
    },
  },
};
</script>

<style scoped>
.operate-div {
  margin-bottom: 16px;
}
</style>
