import type { ReactNode } from "react";

export function ErrorBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="error-box" role="alert">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
