import { useApp } from '../state/AppContext';

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)} role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}
