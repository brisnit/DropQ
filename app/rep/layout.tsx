export const metadata = { title: "Sales Rep — DropQ" };

// Auth is enforced per-page (the portal page calls requireRep; the login page
// is intentionally public), so this layout is just chrome.
export default function RepLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-cream">{children}</div>;
}
