"use client";
import { useEffect } from "react";

export function PrintButton({ auto }: { auto?: boolean }) {
  useEffect(() => {
    if (auto) setTimeout(() => window.print(), 400);
  }, [auto]);
  return (
    <button type="button" onClick={() => window.print()} className="h-9 rounded-control bg-accent px-4 text-[13px] font-semibold text-white print:hidden">
      Print
    </button>
  );
}
