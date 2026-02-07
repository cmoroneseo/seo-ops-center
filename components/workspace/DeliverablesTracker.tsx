'use client';

import { ClientProject, Deliverable, DeliverableType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FileText, Link as LinkIcon, MapPin, CheckCircle2, Circle, ExternalLink, Calendar, Clock } from 'lucide-react';
import { useState } from 'react';

interface DeliverablesTrackerProps {
    client: ClientProject;
}

export function DeliverablesTracker({ client }: DeliverablesTrackerProps) {
    const deliverables = client.activeDeliverables || [];
    const [filter, setFilter] = useState<DeliverableType | 'All'>('All');

    // Group by type for summary
    const counts = {
        Content: deliverables.filter(d => d.type === 'Content').length,
        Backlink: deliverables.filter(d => d.type === 'Backlink').length,
        GBP: deliverables.filter(d => d.type === 'GBP').length,
        Other: deliverables.filter(d => d.type === 'Other').length,
        All: deliverables.length
    };

    const filteredDeliverables = filter === 'All'
        ? deliverables
        : deliverables.filter(d => d.type === filter);

    const getIcon = (type: DeliverableType) => {
        switch (type) {
            case 'Content': return <FileText className="h-4 w-4" />;
            case 'Backlink': return <LinkIcon className="h-4 w-4" />;
            case 'GBP': return <MapPin className="h-4 w-4" />;
            default: return <Circle className="h-4 w-4" />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Approved': return 'text-green-500 bg-green-500/10 border-green-500/20';
            case 'Published': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            case 'In Progress': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
            case 'Review': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
            default: return 'text-muted-foreground bg-muted border-border';
        }
    };

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col h-full">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Deliverables Tracker
                </h3>
                <div className="flex bg-background rounded-lg p-1 border border-border">
                    {(['All', 'Content', 'Backlink', 'GBP'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setFilter(type)}
                            className={cn(
                                "px-2 py-1 text-xs font-medium rounded transition-all",
                                filter === type ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {type} <span className="opacity-60 ml-1 text-[10px]">{type === 'All' ? counts.All : counts[type]}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {filteredDeliverables.length > 0 ? (
                    <div className="space-y-3">
                        {filteredDeliverables.map(item => (
                            <div key={item.id} className="group border border-border/50 rounded-lg p-3 hover:bg-muted/30 transition-all flex items-start gap-3">
                                <div className={cn("p-2 rounded-md shrink-0",
                                    item.type === 'Content' ? "bg-blue-500/10 text-blue-500" :
                                        item.type === 'Backlink' ? "bg-purple-500/10 text-purple-500" :
                                            item.type === 'GBP' ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
                                )}>
                                    {getIcon(item.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <h4 className="text-sm font-medium truncate">{item.title}</h4>
                                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap", getStatusColor(item.status))}>
                                            {item.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            Due {new Date(item.dueDate).toLocaleDateString()}
                                        </div>
                                        {item.link && (
                                            <a href={item.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                                                <ExternalLink className="h-3 w-3" />
                                                View Link
                                            </a>
                                        )}
                                        {item.countsTowardsHours && (
                                            <span className="text-green-500 font-medium flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                Billable
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-center">
                        <FileText className="h-10 w-10 mb-2 opacity-20" />
                        <p className="text-sm font-medium">No deliverables found</p>
                        <p className="text-xs opacity-60">Select a different filter or add a deliverable</p>
                    </div>
                )}
            </div>
        </div>
    );
}
