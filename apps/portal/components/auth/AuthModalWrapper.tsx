"use client";

import { useRouter } from "next/navigation";
import { usePortal } from "@/lib/portal-context";
import { AuthModal } from "@/components/auth";

export function AuthModalWrapper() {
  const router = useRouter();
  const { authModalOpen, authMode, closeAuthModal, consumeReturnTo } = usePortal();

  return (
    <AuthModal
      isOpen={authModalOpen}
      onClose={closeAuthModal}
      defaultMode={authMode}
      onSuccess={() => {
        const to = consumeReturnTo();
        if (to) router.push(to);
        else window.location.href = "/dashboard";
      }}
    />
  );
}
