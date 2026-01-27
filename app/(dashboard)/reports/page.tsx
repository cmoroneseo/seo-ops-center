'use client';

import { FileText, Sparkles, ArrowRight, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { generateSEOAnalysis, AIInsight } from '@/lib/ai-service';
import { generateMockData } from '@/lib/mock-service';

const reports = [
    { id: 1, title: 'October 2023 SEO Performance', date: 'Oct 31, 2023', status: 'Ready' },
    { id: 2, title: 'September 2023 SEO Performance', date: 'Sep 30, 2023', status: 'Ready' },
    { id: 3, title: 'August 2023 SEO Performance', date: 'Aug 31, 2023', status: 'Ready' },
];

export default function ReportsPage() {
    const [isGenerating, setIsGenerating] = useState(false);
    const [insight, setInsight] = useState<AIInsight | null>(null);

    const handleGenerateInsight = async () => {
        setIsGenerating(true);
        try {
            // In a real app, we would fetch real data here
            const data = generateMockData();
            const result = await generateSEOAnalysis(data);
            setInsight(result);
        } catch (error) {
            console.error("Failed to generate insight", error);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Reports</h2>
                <p className="text-muted-foreground">Monthly summaries and AI-driven insights.</p>
            </div>

            {/* AI Insight Section */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 transition-all">
                <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-primary">AI Opportunity Detector</h3>
                </div>

                {!insight ? (
                    <div className="text-center py-8">
                        <p className="text-muted-foreground mb-4">Generate a real-time analysis of your current SEO metrics using our AI engine.</p>
                        <button
                            onClick={handleGenerateInsight}
                            disabled={isGenerating}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Analyzing Data...
                                </>
                            ) : (
                                <>
                                    Generate Optimization Plan <ArrowRight className="h-4 w-4" />
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="bg-card/50 rounded-lg p-4 border border-border">
                            <p className="text-foreground font-medium">{insight.summary}</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold text-green-500">Top Opportunities</h4>
                                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                    {insight.opportunities.map((opp, i) => (
                                        <li key={i}>{opp}</li>
                                    ))}
                                </ul>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold text-red-500">Risk Factors</h4>
                                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                    {insight.risks.map((risk, i) => (
                                        <li key={i}>{risk}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setInsight(null)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                Reset Analysis
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="grid gap-6">
                <h3 className="text-xl font-semibold">Monthly Reports</h3>
                <div className="space-y-4">
                    {reports.map((report) => (
                        <div key={report.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/5">
                            <div className="flex items-center gap-4">
                                <div className="rounded-full bg-muted p-2">
                                    <FileText className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <div>
                                    <h4 className="font-medium">{report.title}</h4>
                                    <p className="text-sm text-muted-foreground">Generated on {report.date}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-500">
                                    {report.status}
                                </span>
                                <button className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                                    <Download className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
