'use client';

import React from 'react';
import { ClientProject } from '@/lib/types';
import { cn, isClientAtRisk } from '@/lib/utils';
import { AlertCircle, CheckCircle2, Clock, AlertTriangle, ChevronDown, ChevronRight, Calendar, User } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TimeLogModal } from './TimeLogModal';
import { mockClients } from '@/lib/mock-data/workspace';

interface ClientTableProps {
    clients: ClientProject[];
}

export function ClientTable({ clients }: ClientTableProps) {
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [isTimeLogOpen, setIsTimeLogOpen] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState<string | undefined>(undefined);

    const handleLogTime = (clientId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedClientId(clientId);
        setIsTimeLogOpen(true);
    };

    const toggleRow = (clientId: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(clientId)) {
            newExpanded.delete(clientId);
        } else {
            newExpanded.add(clientId);
        }
        setExpandedRows(newExpanded);
    };

    return (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground font-medium">
                        <tr>
                            <th className="px-4 py-3 w-10"></th>
                            <th className="px-4 py-3 min-w-[200px]">Client</th>
                            <th className="px-4 py-3 whitespace-nowrap">Launch Date</th>
                            <th className="px-4 py-3 text-center">SEO Hours</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Deliverables</th>
                            <th className="px-4 py-3 text-center">Blogs/Mo</th>
                            <th className="px-4 py-3">Manager</th>
                            <th className="px-4 py-3 text-center">Approvals</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-center">Tier</th>
                            <th className="px-4 py-3 min-w-[150px]">Blog Progress</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                        {clients.map((client) => {
                            const atRisk = isClientAtRisk(client);
                            const isExpanded = expandedRows.has(client.id);
                            const hasTasks = client.tasks && client.tasks.length > 0;

                            // ... inside component
                            return (
                                <React.Fragment key={client.id}>
                                    <tr className={cn(
                                        "transition-colors hover:bg-muted/20",
                                        atRisk && "bg-red-500/5 hover:bg-red-500/10",
                                        isExpanded && "bg-muted/30"
                                    )}>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggleRow(client.id)}
                                                className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground"
                                            >
                                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 font-medium text-foreground">
                                            <div className="flex items-center gap-2">
                                                {atRisk && (
                                                    <div className="text-red-500" title="At Risk: Falling behind schedule">
                                                        <AlertTriangle className="h-4 w-4" />
                                                    </div>
                                                )}
                                                <Link href={`/workspace/${client.id}`} className="hover:text-primary transition-colors hover:underline">
                                                    {client.clientName}
                                                </Link>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <span>{new Date(client.launchDate).toLocaleDateString()}</span>
                                                <button
                                                    onClick={(e) => handleLogTime(client.id, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/10 rounded text-primary transition-all"
                                                    title="Log Time"
                                                >
                                                    <Clock className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-xs">
                                                {client.seoHours}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border border-border bg-muted/30">
                                                {client.hourType}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">{client.deliverables}</td>
                                        <td className="px-4 py-3 text-center font-medium">{client.blogsDuePerMonth}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                                                    {client.accountManager.charAt(0)}
                                                </div>
                                                <span className="text-muted-foreground">{client.accountManager}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {client.approvals.pendingCount > 0 ? (
                                                <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-orange-500/10 text-orange-500 font-medium text-xs">
                                                    {client.approvals.pendingCount} Pending
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={cn(
                                                "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border",
                                                client.status === 'Active' && "bg-green-500/10 text-green-500 border-green-500/20",
                                                client.status === 'Paused' && "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
                                                client.status === 'Cancelled' && "bg-red-500/10 text-red-500 border-red-500/20",
                                                client.status === 'Onboarding' && "bg-blue-500/10 text-blue-500 border-blue-500/20",
                                            )}>
                                                <span className="relative flex h-1.5 w-1.5">
                                                    <span className={cn(
                                                        "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                                                        client.status === 'Active' ? "bg-green-500" : "hidden"
                                                    )}></span>
                                                    <span className={cn(
                                                        "relative inline-flex rounded-full h-1.5 w-1.5",
                                                        client.status === 'Active' && "bg-green-500",
                                                        client.status === 'Paused' && "bg-yellow-500",
                                                        client.status === 'Cancelled' && "bg-red-500",
                                                        client.status === 'Onboarding' && "bg-blue-500"
                                                    )}></span>
                                                </span>
                                                {client.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center text-muted-foreground text-xs">T{client.tier}</td>
                                        <td className="px-4 py-3">
                                            {client.blogProgress.target > 0 ? (
                                                <div className="flex flex-col gap-1.5 min-w-[140px]">
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className={cn(
                                                            "font-medium",
                                                            client.blogProgress.isOnTrack ? "text-green-500" : "text-red-500"
                                                        )}>
                                                            {client.blogProgress.delivered} / {client.blogProgress.target}
                                                        </span>
                                                        {client.blogProgress.isOnTrack ? (
                                                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                                                        ) : (
                                                            <AlertCircle className="w-3 h-3 text-red-500" />
                                                        )}
                                                    </div>
                                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                                        <div
                                                            className={cn(
                                                                "h-full rounded-full transition-all duration-500",
                                                                client.blogProgress.isOnTrack ? "bg-green-500" : "bg-red-500"
                                                            )}
                                                            style={{ width: `${(client.blogProgress.delivered / client.blogProgress.target) * 100}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground text-xs italic">No blogs</span>
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr className="bg-muted/10">
                                            <td colSpan={12} className="px-4 py-4">
                                                <div className="pl-14">
                                                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                                        <CheckCircle2 className="h-4 w-4 text-primary" />
                                                        Active Tasks
                                                    </h4>
                                                    {hasTasks ? (
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                            {client.tasks.map(task => (
                                                                <div key={task.id} className="bg-card border border-border rounded-lg p-3 shadow-sm flex flex-col gap-2">
                                                                    <div className="flex items-start justify-between">
                                                                        <span className="font-medium text-sm">{task.title}</span>
                                                                        <span className={cn(
                                                                            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                                                                            task.priority === 'high' && "bg-red-500/10 text-red-500 border-red-500/20",
                                                                            task.priority === 'medium' && "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
                                                                            task.priority === 'low' && "bg-blue-500/10 text-blue-500 border-blue-500/20",
                                                                        )}>
                                                                            {task.priority}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto">
                                                                        <div className="flex items-center gap-1">
                                                                            <User className="h-3 w-3" />
                                                                            {task.assignee}
                                                                        </div>
                                                                        <div className="flex items-center gap-1">
                                                                            <Calendar className="h-3 w-3" />
                                                                            {new Date(task.dueDate).toLocaleDateString()}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm text-muted-foreground italic">No active tasks found.</div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <TimeLogModal
                isOpen={isTimeLogOpen}
                onClose={() => setIsTimeLogOpen(false)}
                clients={mockClients}
                initialClientId={selectedClientId}
            />
        </div>
    );
}
