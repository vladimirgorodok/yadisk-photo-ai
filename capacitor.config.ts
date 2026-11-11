import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yadiskphotoai.app',
  appName: 'Диск Фото AI',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
