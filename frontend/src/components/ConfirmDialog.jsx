import { AlertTriangle, X } from "lucide-react";

export default function ConfirmDialog({
  open,
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`dialog-icon ${danger ? "dialog-icon-danger" : ""}`}>
          <AlertTriangle size={20} />
        </div>
        <button className="dialog-close" type="button" onClick={onCancel} aria-label="Close dialog">
          <X size={17} />
        </button>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} type="button" onClick={onConfirm} disabled={loading}>
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
