import { notFound } from 'next/navigation';
import TrainingPage from '@/app/(dashboard)/training/page';
import { Sidebar } from '@/components/dashboard/Sidebar';

export default function TrainingPreviewPage() {
    if (process.env.NODE_ENV === 'production') notFound();

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <main className="min-w-0 flex-1 overflow-y-auto pb-20 xl:overflow-hidden xl:pb-0">
                <TrainingPage />
            </main>
        </div>
    );
}
