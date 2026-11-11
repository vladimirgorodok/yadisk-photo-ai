import { Capacitor } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

if (Capacitor.isNativePlatform()) {
  // В APK service worker не нужен: все ресурсы лежат локально. Если он успел
  // зарегистрироваться от прошлой версии приложения, снимаем его — иначе
  // WebView может продолжать отдавать устаревший precache после обновления.
  navigator.serviceWorker
    ?.getRegistrations()
    .then(async (regs) => {
      if (!regs.length) return;
      await Promise.all(regs.map((r) => r.unregister()));
      location.reload(); // сразу показать свежий код без старого SW
    })
    .catch(() => {
      /* сервис-воркер недоступен — не страшно */
    });
} else {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(<App />);
