import Image from "next/image";

const frameClass = "h-auto w-full";

export function ProductShot({
    desktopSrc,
    desktopWidth,
    desktopHeight,
    mobileSrc,
    mobileWidth,
    mobileHeight,
    alt,
    caption,
    priority = false,
}: {
    desktopSrc: string;
    desktopWidth: number;
    desktopHeight: number;
    mobileSrc: string;
    mobileWidth: number;
    mobileHeight: number;
    alt: string;
    caption: string;
    priority?: boolean;
}) {
    return (
        <figure>
            <Image
                src={mobileSrc}
                alt={alt}
                width={mobileWidth}
                height={mobileHeight}
                quality={90}
                priority={priority}
                sizes="100vw"
                className={`${frameClass} md:hidden`}
            />
            <Image
                src={desktopSrc}
                alt={alt}
                width={desktopWidth}
                height={desktopHeight}
                quality={90}
                priority={priority}
                sizes="(min-width: 768px) 1200px, 100vw"
                className={`${frameClass} hidden md:block`}
            />
            <figcaption className="mt-3 text-center text-[13px] text-[#71717a]">{caption}</figcaption>
        </figure>
    );
}
