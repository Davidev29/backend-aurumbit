export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap" role="main">
      {children}
    </main>
  );
}
