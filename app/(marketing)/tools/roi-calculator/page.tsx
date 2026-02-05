"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Calculator, ArrowRight, TrendingUp, DollarSign, Users } from "lucide-react";

export default function ROICalculatorPage() {
    const [inputs, setInputs] = useState({
        retainer: 2500,
        currentTraffic: 5000,
        convRate: 2,
        leadValue: 150,
        projectedIncrease: 50,
    });

    const results = useMemo(() => {
        const currentRevenue = (inputs.currentTraffic * (inputs.convRate / 100) * inputs.leadValue);
        const projectedTraffic = inputs.currentTraffic * (1 + inputs.projectedIncrease / 100);
        const projectedRevenue = (projectedTraffic * (inputs.convRate / 100) * inputs.leadValue);
        const monthlyROI = ((projectedRevenue - currentRevenue - inputs.retainer) / inputs.retainer) * 100;
        const annualImpact = (projectedRevenue - currentRevenue) * 12;

        return {
            currentRevenue,
            projectedRevenue,
            monthlyROI,
            annualImpact,
            gain: projectedRevenue - currentRevenue
        };
    }, [inputs]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setInputs(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    };

    return (
        <div className="container mx-auto px-4 pt-32 pb-20">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center max-w-3xl mx-auto mb-16"
            >
                <h1 className="text-4xl md:text-6xl font-bold mb-6">
                    SEO Client <span className="text-primary text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">ROI Calculator</span>
                </h1>
                <p className="text-xl text-muted-foreground">
                    Stop guessing. Show your clients the financial impact of your SEO work with hard data and clear projections.
                </p>
            </motion.div>

            <div className="grid lg:grid-cols-2 gap-12 items-start">
                {/* Inputs */}
                <Card className="border-white/10 bg-white/5 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Calculator className="h-5 w-5 text-primary" />
                            Campaign Variables
                        </CardTitle>
                        <CardDescription>Adjust the numbers below to see the projected impact.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="retainer">Monthly Retainer ($)</Label>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="retainer"
                                        name="retainer"
                                        type="number"
                                        value={inputs.retainer}
                                        onChange={handleInputChange}
                                        className="pl-9 bg-black/40"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="leadValue">Lead Value ($)</Label>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="leadValue"
                                        name="leadValue"
                                        type="number"
                                        value={inputs.leadValue}
                                        onChange={handleInputChange}
                                        className="pl-9 bg-black/40"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="currentTraffic">Monthly Traffic</Label>
                                <div className="relative">
                                    <Users className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="currentTraffic"
                                        name="currentTraffic"
                                        type="number"
                                        value={inputs.currentTraffic}
                                        onChange={handleInputChange}
                                        className="pl-9 bg-black/40"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="convRate">Conversion Rate (%)</Label>
                                <Input
                                    id="convRate"
                                    name="convRate"
                                    type="number"
                                    value={inputs.convRate}
                                    onChange={handleInputChange}
                                    className="bg-black/40"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="projectedIncrease">Projected Traffic Increase (%)</Label>
                            <Input
                                id="projectedIncrease"
                                name="projectedIncrease"
                                type="number"
                                value={inputs.projectedIncrease}
                                onChange={handleInputChange}
                                className="bg-black/40"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Results */}
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <Card className="border-white/5 bg-white/5">
                            <CardContent className="pt-6">
                                <div className="text-sm text-muted-foreground font-medium mb-1">Current Revenue</div>
                                <div className="text-2xl font-bold">${results.currentRevenue.toLocaleString()}</div>
                            </CardContent>
                        </Card>
                        <Card className="border-white/5 bg-primary/10 border-primary/20">
                            <CardContent className="pt-6">
                                <div className="text-sm text-primary font-medium mb-1">Projected Revenue</div>
                                <div className="text-2xl font-bold text-primary">${results.projectedRevenue.toLocaleString()}</div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-background to-accent/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                            <TrendingUp className="h-24 w-24" />
                        </div>
                        <CardHeader>
                            <CardTitle className="text-3xl font-bold">
                                {results.monthlyROI > 0 ? '+' : ''}{results.monthlyROI.toFixed(0)}% <span className="text-lg font-normal text-muted-foreground">Monthly ROI</span>
                            </CardTitle>
                            <CardDescription>Based on your monthly retainer and projected growth.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-4 mb-8">
                                <div className="p-3 rounded-xl bg-primary/20 text-primary">
                                    <DollarSign className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Annual Financial Impact</div>
                                    <div className="text-2xl font-bold text-foreground">+${results.annualImpact.toLocaleString()}</div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-lg shadow-xl shadow-primary/20">
                                    Download Full ROI Report
                                </Button>
                                <p className="text-center text-xs text-muted-foreground">
                                    Join 500+ SEO agencies using SEO Ops Center to prove their value.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
