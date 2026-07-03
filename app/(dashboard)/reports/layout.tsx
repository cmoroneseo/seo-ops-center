import { ActiveClientProvider } from '@/components/reports/ActiveClientContext';

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
    return <ActiveClientProvider>{children}</ActiveClientProvider>;
}
