"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePortal } from "@/lib/portal-context";

/** Abre o AuthModal quando o middleware redireciona com `?login=1`. */
export function LoginParamOpener() {
  const params = useSearchParams();
  const { openAuthModal } = usePortal();

  useEffect(() => {
    if (params.get("login") === "1") {
      openAuthModal("login");
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return null;
}
