import Link from 'next/link';
import { projectsHref } from '@/lib/projects/project-links';

export function ProjectBreadcrumb({ clientId, title }: { clientId: string; title: string }) {
    return (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Link href={projectsHref(clientId)} className="font-medium text-primary hover:underline">Projects</Link>
            <span aria-hidden>/</span>
            <span aria-current="page" className="min-w-0 truncate text-foreground">{title}</span>
        </nav>
    );
}
