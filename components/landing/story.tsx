import { BarChart3, CalendarDays, UserRound } from "lucide-react";

const points = [
    {
        n: "01",
        title: "Data tools show clicks and keywords.",
        icon: BarChart3,
        accent: false,
    },
    {
        n: "02",
        title: "Project tools show tasks and dates.",
        icon: CalendarDays,
        accent: false,
    },
    {
        n: "03",
        title: "Clients still ask: what shipped, and did it matter?",
        icon: UserRound,
        accent: true,
    },
];

export function Story() {
    return (
        <section className="bg-[#fafafa] py-20 md:py-28">
            <div className="mx-auto w-full max-w-[1200px] px-5 lg:px-0">
                <h2 className="text-center text-[30px] font-bold tracking-[-0.025em] text-[#18181b] md:text-[36px]">
                    Most SEO stacks split the truth.
                </h2>
                <div className="mt-12 grid gap-10 md:mt-16 md:grid-cols-3 md:gap-8">
                    {points.map((point) => {
                        const Icon = point.icon;
                        return (
                            <div
                                key={point.n}
                                className={point.accent ? "border-t-2 border-[#ec4899] pt-5" : "border-t border-[#e4e4e7] pt-5"}
                            >
                                <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-[#71717a]">
                                    <span className={`flex h-7 w-7 items-center justify-center rounded-md border bg-white ${point.accent ? "border-[#fbcfe8] text-[#ec4899]" : "border-[#e4e4e7] text-[#18181b]"}`}>
                                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                    </span>
                                    {point.n}
                                </div>
                                <h3 className="max-w-[280px] text-[18px] font-bold leading-snug tracking-[-0.02em] text-[#18181b] md:text-[20px]">
                                    {point.title}
                                </h3>
                            </div>
                        );
                    })}
                </div>
                <p className="mx-auto mt-12 max-w-[720px] text-center text-[15px] leading-relaxed text-[#3f3f46] md:mt-16 md:max-w-none md:text-[16px]">
                    SEO Ops Center is the client workspace in the middle — performance, roadmap, and delivery on the same account.
                </p>
            </div>
        </section>
    );
}
