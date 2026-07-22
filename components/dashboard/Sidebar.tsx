'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckSquare, Briefcase, ClipboardList, PackageCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export const navigation = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Workspace', href: '/workspace', icon: Briefcase },
  { name: 'Reports', href: '/reports', icon: ClipboardList },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Deliverables', href: '/deliverables', icon: PackageCheck },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="hidden lg:flex h-full w-20 flex-col bg-card border-r border-border items-center py-4">
      <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-bold text-xl shadow-lg shadow-primary/20">
        A
      </div>

      <nav className="mt-8 flex flex-col items-center gap-3 w-full px-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'relative group flex items-center justify-center h-12 w-12 rounded-xl transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              )}
            >
              <item.icon className="h-6 w-6" />
              <div className="absolute left-16 px-2 py-1 bg-popover text-popover-foreground text-xs font-medium rounded border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                {item.name}
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
