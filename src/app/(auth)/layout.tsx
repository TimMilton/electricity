import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-5 sm:px-8">
        <Brand href="/login" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-12">{children}</main>
    </div>
  );
}
