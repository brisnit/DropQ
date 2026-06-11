import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center px-5 text-center">
      <div>
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <p className="font-display text-6xl font-semibold">404</p>
        <h1 className="font-display text-2xl font-semibold mt-2">This page is off the menu</h1>
        <p className="text-muted mt-2 max-w-sm mx-auto">
          The store, drop, or page you're looking for doesn't exist or has moved.
        </p>
        <Link
          href="/"
          className="inline-block mt-6 bg-brand text-white font-medium px-5 py-3 rounded-xl hover:bg-brand-dark transition"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
