import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KPICardProps {
    title: string;
    value: string;
    change: string;
    trend: 'up' | 'down' | 'neutral';
    icon: LucideIcon;
}

export function KPICard({ title, value, change, trend, icon: Icon }: KPICardProps) {
    return (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex items-baseline">
                <span className="text-2xl font-bold text-foreground">{value}</span>
                <span className={cn(
                    "ml-2 text-xs font-medium",
                    trend === 'up' ? "text-green-500" : trend === 'down' ? "text-red-500" : "text-muted-foreground"
                )}>
                    {change}
                </span>
            </div>
        </div>
    );
}
