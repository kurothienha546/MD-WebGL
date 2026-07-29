import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg text-text">
      <h2 className="text-4xl font-serif mb-4">404 - Page Not Found</h2>
      <Link href="/" className="underline text-accent">
        Return Home
      </Link>
    </div>
  );
}
