import Link from 'next/link';

const navItems = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/clients', label: 'Clients' },
  { href: '/admin/workflows', label: 'Workflows' },
  { href: '/admin/routing-rules', label: 'Routing Rules' },
  { href: '/admin/prompts', label: 'Prompts' },
  { href: '/admin/events', label: 'Events' },
  { href: '/admin/approvals', label: 'Approvals' },
  { href: '/admin/audit', label: 'Audit Log' },
  { href: '/admin/mailboxes',      label: 'Mailboxes' },
  { href: '/admin/triage-config',    label: 'Triage Config' },
  { href: '/admin/planning-config', label: 'Planning Config' },
  { href: '/admin/gmail-errors',  label: 'Gmail Errors' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col py-6">
        <div className="px-6 mb-8">
          <span className="text-lg font-bold text-gray-900">Sprigly</span>
          <span className="ml-1 text-xs text-gray-400">admin</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
